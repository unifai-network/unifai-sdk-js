import pLimit from 'p-limit';
import { ToolsAPI } from './api';

interface Function {
  name: string;
  description: string;
  parameters: { [key: string]: any };
}

interface Tool {
  type: 'function';
  function: Function;
}

interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

interface OpenAIToolCall {
  id: string;
  type: string;
  function: OpenAIFunctionCall;
}

interface OpenAIToolResult {
  role: string;
  tool_call_id: string;
  content: string;
}

enum FunctionName {
  SEARCH_TOOLS = 'search_services',
  CALL_TOOL = 'invoke_service',
}

export const functionList: Function[] = [
  {
    name: FunctionName.SEARCH_TOOLS,
    description: `Search for tools. The tools cover a wide range of domains include data source, API, SDK, etc. Try searching whenever you need to use a tool. Returned actions should ONLY be used in ${FunctionName.CALL_TOOL}.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query to search for tools, you can describe what you want to do or what tools you want to use'
        },
        limit: {
          type: 'number',
          description: 'The maximum number of tools to return, must be between 1 and 100, default is 10, recommend at least 10'
        },
        unverified: {
          type: 'boolean',
          description: 'Whether to include unverified tools in search results, default is false'
        }
      },
      required: ['query'],
    },
  },
  {
    name: FunctionName.CALL_TOOL,
    description: `Call a tool returned by ${FunctionName.SEARCH_TOOLS}`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: `The exact action you want to call in the ${FunctionName.SEARCH_TOOLS} result.`
        },
        payload: {
          type: 'string',
          description: `Action payload, a json encoded string of the object based on the payload schema in the ${FunctionName.SEARCH_TOOLS} result.`,
        },
        payment: {
          type: 'number',
          description: 'Amount to authorize in USD. Positive number means you will be charged no more than this amount, negative number means you are requesting to get paid for at least this amount. Only include this field if the action you are calling includes payment information.',
        }
      },
      required: ['action', 'payload'],
    },
  },
];

const toolList: Tool[] = functionList.map(func => ({
  type: 'function',
  function: func
}));

interface ToolsConfig {
  apiKey: string;
}

export class Tools {
  private api: ToolsAPI;

  /**
   * A class to interact with the UnifAI Tools API.
   * 
   * @param config - The configuration object
   * @param config.apiKey - The API key of your agent
   */
  constructor({ apiKey }: ToolsConfig) {
    this.api = new ToolsAPI({ apiKey });
  }

  /**
   * Set the API endpoint for the tools.
   * 
   * @param endpoint - The API endpoint URL
   */
  public setApiEndpoint(endpoint: string): void {
    this.api.setEndpoint(endpoint);
  }

  /**
   * Fetch static tools from the API based on provided toolkit IDs and action IDs
   * 
   * @param staticToolkits - List of toolkit IDs to include
   * @param staticActions - List of action IDs to include
   * @param unverified - Whether to include unverified tools in search results
   * @returns List of Tool objects
   */
  private async fetchStaticTools(
    staticToolkits: string[] | null = null,
    staticActions: string[] | null = null,
    unverified: boolean = false,
  ): Promise<Tool[]> {
    const staticTools: Tool[] = [];

    try {
      if (staticToolkits?.length || staticActions?.length) {
        const args: Record<string, any> = { limit: 100 };
        
        if (staticToolkits?.length) {
          args.includeToolkits = staticToolkits;
        }
        
        if (staticActions?.length) {
          args.includeActions = staticActions;
        }
        
        if (unverified) {
          args.unverified = true;
        }
        
        const actions = await this.api.searchTools(args);

        for (const action of actions) {
          const actionName = action.action || '';
          const actionDesc = action.description || '';
          const payloadSchema = action.payload || {};
          const paymentInfo = action.payment || null;

          if (!actionName) {
            console.warn(`Action name is empty for action:`, action);
            continue;
          }

          const parameters: any = {
            type: 'object',
            properties: {
              payload: {
                type: 'string',
                description: `payload is a json encoded string of the object with the following properties: ${typeof payloadSchema === 'object' ? JSON.stringify(payloadSchema) : payloadSchema}`,
              },
            },
            required: ['payload'],
          };

          if (paymentInfo) {
            parameters.properties.payment = {
              type: 'number',
              description: 
                "Amount to authorize in USD. " +
                "Positive number means you will be charged no more than this amount, " +
                "negative number means you are requesting to get paid for at least this amount. " +
                `Determine the payment amount based on the following payment information: ${JSON.stringify(paymentInfo)}`
            };
          }

          staticTools.push({
            type: 'function',
            function: {
              name: actionName,
              description: actionDesc,
              parameters
            }
          });
        }
      }
      
      return staticTools;
    } catch (error) {
      console.warn(`Failed to fetch static resources via searchTools:`, error);
      return [];
    }
  }

  /**
   * Get the list of tools in OpenAI API compatible format.
   * 
   * @param options - Options for getting tools
   * @param options.dynamicTools - Whether to include dynamic tools (default: true)
   * @param options.staticToolkits - List of static toolkit IDs to include
   * @param options.staticActions - List of static action IDs to include 
   * @param options.cacheControl - Whether to include cache control
   * @param options.unverified - Whether to include unverified tools in search results
   * @returns List of tools in OpenAI API compatible format
   */
  public async getTools(
    options: {
      dynamicTools?: boolean;
      staticToolkits?: string[] | null;
      staticActions?: string[] | null;
      cacheControl?: boolean;
      unverified?: boolean;
    } = {}
  ): Promise<any[]> {
    const { 
      dynamicTools = true, 
      staticToolkits = null, 
      staticActions = null,
      cacheControl = false,
      unverified = false,
    } = options;

    const tools: any[] = [];

    if (dynamicTools) {
      tools.push(...toolList);
    }

    if (staticToolkits?.length || staticActions?.length) {
      const staticTools = await this.fetchStaticTools(staticToolkits, staticActions, unverified);
      tools.push(...staticTools);
    }
    
    if (cacheControl && tools.length > 0) {
      tools[tools.length - 1].cache_control = { type: 'ephemeral' };
    }
    
    return tools;
  }

  /**
   * Call a tool by name with arguments
   * 
   * @param name - The tool name or FunctionName enum
   * @param args - The arguments for the tool
   * @returns The result of the tool call
   */
  public async callTool(name: string | FunctionName, args: any): Promise<any> {
    const toolName = typeof name === 'string' ? name : FunctionName[name];
    const params = typeof args === 'string' ? JSON.parse(args) : args;

    if (toolName === FunctionName.SEARCH_TOOLS) {
      return await this.api.searchTools(params);
    } else if (toolName === FunctionName.CALL_TOOL) {
      return await this.api.callTool(params);
    } else {
      try {
        return await this.api.callTool({
          action: toolName,
          ...params,
        });
      } catch (error) {
        throw new Error(`Failed to call tool ${toolName}: ${error}`);
      }
    }
  }

  /**
   * Call multiple tools concurrently
   * 
   * @param toolCalls - The list of tool calls from the LLM response
   * @param concurrency - The maximum number of concurrent tool calls (default: 1)
   * @returns List of tool results in OpenAI API compatible format
   */
  public async callTools(toolCalls: OpenAIToolCall[] | null = null, concurrency: number = 1): Promise<OpenAIToolResult[]> {
    if (!toolCalls) return [];

    const limit = pLimit(concurrency);
    const tasks = toolCalls.map(toolCall =>
      limit(async (): Promise<OpenAIToolResult | null> => {
        let result: any;
        try {
          result = await this.callTool(toolCall.function.name, toolCall.function.arguments);
          if (result === null) return null;
        } catch (error: unknown) {
          result = { error: error instanceof Error ? error.message : String(error) };
        }
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        }
      })
    );

    const results = await Promise.all(tasks);
    return results.filter((result: OpenAIToolResult | null): result is OpenAIToolResult => result !== null);
  }
}
