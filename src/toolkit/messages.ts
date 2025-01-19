export enum ServerToToolkitMessageType {
  ACTION = "action",
  TOOLKIT = "toolkit",
}

export enum ToolkitToServerMessageType {
  REGISTER_ACTIONS = "registerActions",
  ACTION_RESULT = "actionResult",
}

export interface ServerToToolkitMessage {
  type: ServerToToolkitMessageType;
  data?: Record<string, any>;
}

export interface ActionMessageData {
  action: string;
  actionID: number;
  agentID: number;
  payload?: Record<string, any> | string;
  payment?: number;
}

export interface ToolkitToServerMessage {
  type: ToolkitToServerMessageType;
  data: any;
}

export interface ActionDescription {
  description: string | object;
  payload: string | object;
  payment: string | object;
}

export interface RegisterActionsMessageData {
  actions: Record<string, ActionDescription>;
}

export interface ActionResultMessageData {
  action: string;
  actionID: number;
  agentID: number;
  payload: any;
  payment?: number;
}