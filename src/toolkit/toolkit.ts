import WebSocket from 'ws';
import JSONbig from 'json-bigint';
import { EventEmitter } from 'events';
import { BACKEND_WS_ENDPOINT } from '../common';
import { ActionContext, ActionResult } from './context';
import { ToolkitAPI } from './api';
import { ToolsAPI } from '../tools/api';
import { ActionDescription, ServerToToolkitMessage, ServerToToolkitMessageType, ActionMessageData, ToolkitToServerMessage, ToolkitToServerMessageType, RegisterActionsMessageData } from './messages';

interface ActionHandler {
  func: (ctx: ActionContext, payload: any, payment?: number) => Promise<ActionResult> | ActionResult;
  actionDescription: string | object;
  payloadDescription: string | object;
  paymentDescription: string | object;
}

interface ToolkitConfig {
  apiKey: string;
  reconnectInterval?: number;
}

export class Toolkit extends EventEmitter {
  private id: string | null;
  private apiKey: string;
  public wsEndpoint: string;
  public ws: WebSocket | null;
  public reconnectInterval: number;
  public actionHandlers: { [key: string]: ActionHandler };
  public api: ToolkitAPI;
  private toolsAPI: ToolsAPI | null;

  constructor({ apiKey, reconnectInterval = 5000 }: ToolkitConfig) {
    super();
    this.apiKey = apiKey;
    this.reconnectInterval = reconnectInterval;
    this.ws = null;
    this.actionHandlers = {};
    this.wsEndpoint = BACKEND_WS_ENDPOINT;
    this.api = new ToolkitAPI({ apiKey });
    this.toolsAPI = new ToolsAPI({});;
    this.id = null;
    this.setWsEndpoint(BACKEND_WS_ENDPOINT);
  }

  /**
   * Set the WebSocket endpoint for the toolkit.
   * 
   * @param endpoint - The WebSocket endpoint URL
   */
  public setWsEndpoint(endpoint: string): void {
    this.wsEndpoint = `${endpoint}?type=toolkit&api-key=${this.apiKey}`;
  }

  /**
   * Set the API endpoint for the toolkit.
   * 
   * @param endpoint - The API endpoint URL
   */
  public setApiEndpoint(endpoint: string): void {
    this.api.setEndpoint(endpoint);
  }

  /**
   * Register an action handler.
   *
   * @param config - Configuration for the action.
   * @param handler - The handler function.
   */
  public action(
    config: {
      action: string;
      actionDescription?: string | object;
      payloadDescription?: string | object;
      paymentDescription?: string | object;
    },
    handler: (ctx: ActionContext, payload: any, payment?: number) => Promise<ActionResult> | ActionResult
  ): void {
    this.actionHandlers[config.action] = {
      func: handler,
      actionDescription: config.actionDescription || '',
      payloadDescription: config.payloadDescription || '',
      paymentDescription: config.paymentDescription || '',
    };
  }

  public event(eventName: string, handler: (...args: any[]) => void): void {
    this.on(eventName, handler);
  }

  /**
   * Get information about the current toolkit.
   * 
   * @returns Promise containing toolkit information
   */
  public async me(): Promise<any> {
    return await this.api.me();
  }

  /**
   * Update the toolkit's name and/or description.
   * 
   * @param info - An object containing optional name and/or description for the toolkit
   * @param info.name - Optional new name for the toolkit
   * @param info.description - Optional new description for the toolkit
   */
  public async updateToolkit(info: { name?: string, description?: string }): Promise<void> {
    await this.api.updateToolkit(info);
  }

  private async handleAction(actionData: ActionMessageData): Promise<void> {
    const actionName = actionData.action;
    const handler = this.actionHandlers[actionName];

    if (handler) {
      const ctx = new ActionContext(
        this,
        actionData.agentID,
        actionData.actionID,
        actionName,
      );
      let payload = actionData.payload ?? {};
      let payment = actionData.payment;

      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
        }
      }

      try {
        const result = await handler.func(ctx, payload, payment);
        if (!result) {
          console.warn(`Action handler '${actionName}' returned None, sending empty result.`);
          await ctx.sendResult(ctx.result(null));
        } else {
          await ctx.sendResult(result);
        }
      } catch (error) {
        console.error(`Error handling action '${actionName}', please consider adding error handling and notify the caller:`, error);
        await ctx.sendResult(ctx.result({ error: "An unexpected error occurred, please report to the toolkit developer" }));
      }
    } else {
      console.warn(`No handler for action '${actionName}'`);
    }
  }

  private async handleMessage(message: string): Promise<void> {
    try {
      const msg: ServerToToolkitMessage = JSONbig.parse(message);
      if (msg.type === ServerToToolkitMessageType.ACTION) {
        await this.handleAction(msg.data as ActionMessageData);
      }
    } catch (error) {
      console.warn('Failed to handle message:', error);
    }
  }

  private async connect(): Promise<void> {
    try {
      const result = await this.me();
      this.id = result.id;
    } catch (error) {
      console.error('Failed to get self ID:', error);
    }

    while (true) {
      try {
        this.ws = new WebSocket(this.wsEndpoint);

        this.ws.on('open', async () => {
          console.log('WebSocket connection established.');

          const actionsData: Record<string, ActionDescription> = {};
          for (const [action, handler] of Object.entries(this.actionHandlers)) {
            actionsData[action] = {
              description: handler.actionDescription,
              payload: handler.payloadDescription,
              payment: handler.paymentDescription,
            };
          }

          const setActionsMessage: ToolkitToServerMessage = {
            type: ToolkitToServerMessageType.REGISTER_ACTIONS,
            data: { actions: actionsData } as RegisterActionsMessageData,
          };

          this.ws?.send(JSON.stringify(setActionsMessage));

          const pingInterval = setInterval(() => {
            this.ws?.ping();
          }, 30000);

          this.ws?.on('close', () => {
            clearInterval(pingInterval);
          });

          this.emit('ready');
        });

        this.ws.on('ping', () => {
          this.ws?.pong();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
          await this.handleMessage(data.toString());
        });

        await new Promise((resolve, reject) => {
          let searchInterval: any = null;
          if (Object.keys(this.actionHandlers).length > 0 && this.toolsAPI && this.id) {
            searchInterval = setInterval(async () => {
              let retryCount = 0;
              const maxRetries = 3;
              while (retryCount < maxRetries) {
                try {
                  const result = await this.toolsAPI!.searchTools({ includeToolkits: this.id });
                  if (!result || (Array.isArray(result) && result.length === 0)) {
                    throw new Error('No actions found, there might be a problem with the connection or the server');
                  }
                  break;
                } catch (error) {
                  retryCount++;
                  if (retryCount >= maxRetries) {
                    clearInterval(searchInterval);
                    reject(error);
                    return;
                  }
                  const delay = Math.pow(2, retryCount) * 1000;
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }, 30000);
          }

          this.ws?.on('close', () => {
            clearInterval(searchInterval);
            resolve(null);
          });

          this.ws?.on('error', (error) => {
            clearInterval(searchInterval);
            reject(error);
          });
        });
      } catch (error) {
        console.error('Error during WebSocket connection:', error);
        this.ws?.close();
      } finally {
        console.info(`Reconnecting in ${this.reconnectInterval / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, this.reconnectInterval));
      }
    }
  }

  /**
   * Start the toolkit client.
   */
  public async run(): Promise<void> {
    await this.connect();
  }
}
