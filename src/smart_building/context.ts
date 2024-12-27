import WebSocket from 'ws';
import JSONbig from 'json-bigint';
export class ActionContext {
  public playerId: string;
  public playerName: string;
  public building: any;
  private websocket: WebSocket;
  private actionId: string;
  private actionName: string;

  constructor(
    playerId: string,
    playerName: string,
    building: any,
    websocket: WebSocket,
    actionId: string,
    actionName: string
  ) {
    this.playerId = playerId;
    this.playerName = playerName;
    this.building = building;
    this.websocket = websocket;
    this.actionId = actionId;
    this.actionName = actionName;
  }

  /**
   * Sends the result of the action back to the server.
   *
   * @param payload - The payload to send back as the result.
   * @param payment - The payment amount (positive or negative).
   */
  public async sendResult(payload: any, payment: number = 0): Promise<void> {
    const actionResult = {
      type: 'actionResult',
      data: {
        playerID: this.playerId,
        action: this.actionName,
        actionID: this.actionId,
        payload: payload,
        payment: payment,
      },
    };
    this.websocket.send(JSONbig.stringify(actionResult));
  }
}
