import type { Api } from "telegram";
import type { ChatType } from "../storage/chatRepository";
import { toNumber } from "../utils/misc";

export interface DiscoveredChat {
  id: number;
  title: string;
  username: string | null;
  type: ChatType;
  inputEntity: Api.TypeInputPeer;
}

interface DialogLike {
  id?: unknown;
  title?: string;
  name?: string;
  entity?: {
    megagroup?: boolean;
    broadcast?: boolean;
    username?: string;
    title?: string;
  };
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
  inputEntity?: Api.TypeInputPeer;
}

/**
 * Fetch the dialogs the account can see and map them to channels / groups /
 * supergroups. Private chats with users and bots are intentionally skipped.
 */
export async function discoverChats(client: { getDialogs(): Promise<unknown[]> }): Promise<DiscoveredChat[]> {
  const dialogs = await client.getDialogs();
  const result: DiscoveredChat[] = [];

  for (const raw of dialogs) {
    const d = raw as DialogLike;
    if (!d || d.isUser) continue;
    if (!d.isChannel && !d.isGroup) continue;

    const id = toNumber(d.id);
    if (!id) continue;

    const entity = d.entity ?? {};
    let type: ChatType;
    if (d.isChannel) {
      type = entity.megagroup ? "supergroup" : "channel";
    } else {
      type = "group";
    }

    result.push({
      id,
      title: String(d.title ?? entity.title ?? "unknown").trim() || "unknown",
      username: entity.username ? String(entity.username) : null,
      type,
      inputEntity: d.inputEntity as Api.TypeInputPeer,
    });
  }

  return result;
}
