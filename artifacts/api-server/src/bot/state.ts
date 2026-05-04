export type ConversationAction =
  | "idle"
  | "await_user_info_id"
  | "await_add_coins_id"
  | "await_add_coins_amount"
  | "await_remove_coins_id"
  | "await_remove_coins_amount"
  | "await_set_coins_id"
  | "await_set_coins_amount"
  | "await_block_id"
  | "await_unblock_id"
  | "await_delete_services_id"
  | "await_broadcast_message"
  | "await_dm_user_id"
  | "await_dm_message"
  | "await_add_admin_id"
  | "await_remove_admin_id"
  | "await_add_service_name"
  | "await_add_service_config"
  | "await_set_support"
  | "await_set_channel"
  | "await_set_mandatory_channel"
  | "await_set_invite_reward"
  | "await_set_welcome"
  | "await_broadcast_coins";

export type ConversationState = {
  action: ConversationAction;
  data: Record<string, string | number | boolean>;
};

const states = new Map<number, ConversationState>();

export function getState(userId: number): ConversationState {
  return states.get(userId) ?? { action: "idle", data: {} };
}

export function setState(
  userId: number,
  action: ConversationAction,
  data: Record<string, string | number | boolean> = {}
): void {
  states.set(userId, { action, data });
}

export function clearState(userId: number): void {
  states.set(userId, { action: "idle", data: {} });
}
