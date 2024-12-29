import WebSocket from 'ws';
import JSONbig from 'json-bigint';
import { EventEmitter } from 'events';
import { DEFAULT_WS_ENDPOINT } from '../common/const';
import { ActionContext } from './context';

interface ActionHandler {
  func: Function;
  actionDescription: string;
  payloadDescription: string | object;
  paymentDescription: string;
}

export class SmartBuilding extends EventEmitter {
  public apiKey: string;
  public buildingId: number;
  public players: any[];
  public buildingInfo: any;
  public wsEndpoint: string;
  private ws: WebSocket | null;
  private reconnectInterval: number;
  private actionHandlers: { [key: string]: ActionHandler };

  constructor(options: {
    apiKey: string;
    buildingId: number;
    wsEndpoint?: string;
    reconnectInterval?: number;
  }) {
    super();
    this.apiKey = options.apiKey;
    this.buildingId = options.buildingId;
    this.wsEndpoint = options.wsEndpoint || DEFAULT_WS_ENDPOINT;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.players = [];
    this.buildingInfo = {};
    this.ws = null;
    this.actionHandlers = {};
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
      actionDescription?: string;
      payloadDescription?: string | object;
      paymentDescription?: string;
    },
    handler: Function
  ): void {
    this.actionHandlers[config.action] = {
      func: handler,
      actionDescription: config.actionDescription || '',
      payloadDescription: config.payloadDescription || '',
      paymentDescription: config.paymentDescription || '',
    };
  }

  /**
   * Update the building's name and/or description.
   * 
   * @param name - Optional new name for the building
   * @param description - Optional new description for the building
   */
  public async updateBuilding(name?: string, description?: string): Promise<void> {
    const data: {
      buildingID: number;
      name?: string;
      description?: string;
    } = {
      buildingID: this.buildingId
    };

    if (name) {
      data.name = name;
    }
    if (description) {
      data.description = description;
    }

    const message = {
      type: 'updateBuilding',
      data: data
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Start the smart building client.
   */
  public run(): void {
    this.connect();
  }

  private connect(): void {
    const wsUri = `${this.wsEndpoint}?type=building&api-key=${this.apiKey}&building-id=${this.buildingId}`;
    this.ws = new WebSocket(wsUri);

    this.ws.on('open', () => {
      console.log('WebSocket connection established.');

      const registerActionsMessage = {
        type: 'registerActions',
        data: {
          actions: Object.keys(this.actionHandlers).reduce(
            (acc: any, actionName: string) => {
              const handler = this.actionHandlers[actionName];
              acc[actionName] = {
                description: handler.actionDescription,
                payload: handler.payloadDescription,
                payment: handler.paymentDescription,
              };
              return acc;
            },
            {}
          ),
        },
      };

      this.ws?.send(JSON.stringify(registerActionsMessage));

      this.emit('ready');
    });

    this.ws.on('message', async (data: WebSocket.Data) => {
      await this.handleMessage(data.toString());
    });

    this.ws.on('close', () => {
      console.warn('Connection closed, attempting to reconnect...');
      setTimeout(() => this.connect(), this.reconnectInterval);
    });

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      this.ws?.close();
    });
  }

  private async handleMessage(message: string): Promise<void> {
    try {
      const msg = JSONbig.parse(message);
      const msgType = msg.type;

      if (msgType === 'building') {
        this.buildingInfo = msg.data;
        this.emit('buildingInfo', this.buildingInfo);
      } else if (msgType === 'players') {
        this.players = msg.data;
        this.emit('players', this.players);
      } else if (msgType === 'action') {
        const actionName = msg.data.action;
        const handler = this.actionHandlers[actionName];

        if (handler) {
          const ctx = new ActionContext(
            msg.data.playerID,
            msg.data.playerName,
            this,
            this.ws!,
            msg.data.actionID,
            actionName
          );
          let payload = msg.data.payload ?? {};
          const payment = msg.data.payment;

          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload);
            } catch (e) {
            }
          }

          try {
            if (handler.func.length < 3) {
              await handler.func(ctx, payload);
            } else if (handler.func.length >= 3) {
              await handler.func(ctx, payload, payment);
            } else {
              console.error(`Handler for action '${actionName}' has an unexpected number of parameters`);
            }
          } catch (error) {
            console.error(`Error handling action '${actionName}', please consider adding error handling and notify the caller:`, error);
            await ctx.sendResult({ error: "An unexpected error occurred, please report to the smart tool developer" });
          }
        } else {
          console.warn(`No handler for action '${actionName}'`);
        }
      }
    } catch (error) {
      console.warn('Failed to handle message:', error);
    }
  }
}
