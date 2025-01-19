import JSONbig from 'json-bigint';
import { ToolkitToServerMessage, ToolkitToServerMessageType, ActionResultMessageData } from './messages';
import { Toolkit } from './toolkit';

export class ActionResult {
  payload: any;
  payment: number;

  constructor(payload: any, payment: number = 0) {
    this.payload = payload;
    this.payment = payment;
  }
}

export class ActionContext {
  toolkit: Toolkit;
  agentId: number;
  actionId: number;
  actionName: string;

  constructor(toolkit: Toolkit, agentId: number, actionId: number, actionName: string) {
    this.toolkit = toolkit;
    this.agentId = agentId;
    this.actionId = actionId;
    this.actionName = actionName;
  }

  public result(payload: any, payment: number = 0): ActionResult {
    return new ActionResult(payload, payment);
  }

  public async sendResult(result: ActionResult): Promise<void> {
    const actionResultMessage: ToolkitToServerMessage = {
      type: ToolkitToServerMessageType.ACTION_RESULT,
      data: {
        action: this.actionName,
        actionID: this.actionId,
        agentID: this.agentId,
        payload: result.payload,
        payment: result.payment,
      } as ActionResultMessageData,
    };
    await this.toolkit.ws?.send(JSONbig.stringify(actionResultMessage));
  }
}
