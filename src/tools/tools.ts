import pLimit from 'p-limit';
import { BACKEND_API_ENDPOINT } from '../common/const';
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
  SEARCH_TOOLS = 'search_tools',
  CALL_TOOL = 'call_tool',
}

const functionList: Function[] = [
  {
    name: FunctionName.SEARCH_TOOLS,
    description: 'Search for tools. The tools cover a wide range of domains include data source, API, SDK, etc. Try searching whenever you need to use a tool.',
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
        }
      },
      required: ['query'],
    },
  },
  {
    name: FunctionName.CALL_TOOL,
    description: 'Call a tool returned by search_tools',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The exact action you want to call in the search_tools result.'
        },
        payload: {
          type: 'string',
          description: 'Action payload, based on the payload schema in the search_tools result. You can pass either the json object directly or json encoded string of the object.',
        },
        payment: {
          type: 'number',
          description: 'Amount to authorize in USD. Positive number means you will be charged no more than this amount, negative number means you are requesting to get paid for at least this amount.',
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

  constructor({ apiKey }: ToolsConfig) {
    this.api = new ToolsAPI({ apiKey });
    this.setApiEndpoint(BACKEND_API_ENDPOINT);
  }

  /**
   * Set the API endpoint for the tools.
   * 
   * @param endpoint - The API endpoint URL
   */
  public setApiEndpoint(endpoint: string): void {
    this.api.setEndpoint(endpoint);
  }

  public getTools(): Tool[] {
    return toolList;
  }

  public async callTool(name: string | FunctionName, args: any): Promise<any> {
    const toolName = typeof name === 'string' ? name : FunctionName[name];
    const params = typeof args === 'string' ? JSON.parse(args) : args;

    if (toolName === FunctionName.SEARCH_TOOLS) {
      return await this.api.searchTools(params);
    } else if (toolName === FunctionName.CALL_TOOL) {
      return await this.api.callTool(params);
    } else {
      console.warn(`Unknown tool name: ${toolName}`);
      return null;
    }
  }

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
