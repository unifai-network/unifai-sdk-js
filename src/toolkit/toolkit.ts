import WebSocket from 'ws';
import JSONbig from 'json-bigint';
import { EventEmitter } from 'events';
import { BACKEND_WS_ENDPOINT, FRONTEND_API_ENDPOINT } from '../common/const';
import { ActionContext, ActionResult } from './context';
import { ToolkitAPI } from './api';
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
  private apiKey: string;
  public wsEndpoint: string;
  public ws: WebSocket | null;
  public reconnectInterval: number;
  public actionHandlers: { [key: string]: ActionHandler };
  public api: ToolkitAPI;

  constructor({ apiKey, reconnectInterval = 5000 }: ToolkitConfig) {
    super();
    this.apiKey = apiKey;
    this.reconnectInterval = reconnectInterval;
    this.ws = null;
    this.actionHandlers = {};
    this.wsEndpoint = BACKEND_WS_ENDPOINT;
    this.api = new ToolkitAPI({ apiKey });
    this.setApiEndpoint(FRONTEND_API_ENDPOINT);
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
    while (true) {
      try {
        this.ws = new WebSocket(this.wsEndpoint);

        this.ws.on('open', async () => {
          console.log('WebSocket connection established.');

          const pingInterval = setInterval(() => {
            this.ws?.ping();
          }, 30000);

          this.ws?.on('close', () => {
            clearInterval(pingInterval);
          });

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

          await this.ws?.send(JSON.stringify(setActionsMessage));

          this.emit('ready');
        });

        this.ws.on('ping', () => {
          this.ws?.pong();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
          await this.handleMessage(data.toString());
        });

        await new Promise((resolve, reject) => {
          this.ws?.on('close', resolve);
          this.ws?.on('error', reject);
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
