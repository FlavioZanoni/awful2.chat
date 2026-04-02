import { identityStore } from "$lib/identity/identity.svelte";
import { refreshDmRooms } from "$lib/rooms.svelte";
import {
  deleteMessagesForRoom,
  deletePhonebookEntry,
  deleteRoom,
  getDMRooms,
  getPeerProfile,
  getPhonebookEntries,
  getRoom,
  putMessage,
  putPhonebookEntry,
  putRoom,
  type DMRoom,
} from "$lib/storage";
import { MessageType, type Message } from "$lib/types/message";
import {
  _loadHistory,
  _peerIdToDid,
  _transport,
  transportState,
} from "./transport.svelte";
import {
  looksLikePeerId,
  looksLikeDid,
  resolveToDid,
  didToPeerId,
} from "$lib/identity/identity-utils";

interface DmPayload {
  id: string;
  text: string;
  ts: number;
}

interface QueuedMessage {
  to: string;
  data: number[];
  queuedAt: number;
}

const DM_CHAT_TAG = 0x01;
const DM_ACK_TAG = 0x02;
const DM_QUEUE_KEY = "awful:dm-queue:v1";
const _dmRoomCodeCache = new Map<string, string>();

/**
 * Generate a stable, deterministic DM room code from two DIDs.
 * - Sort the two DIDs alphabetically
 * - Hash them to create a short (48 char max) stable identifier
 * - Prefix with "dm-" for easy identification
 */
async function hashDmRoomCode(did1: string, did2: string): Promise<string> {
  const sorted = [did1, did2].sort();
  const input = sorted.join("|");
  const cacheKey = input;
  const cached = _dmRoomCodeCache.get(cacheKey);
  if (cached) return cached;

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  // Take first 20 bytes (40 hex chars) + "dm-" prefix = 43 chars total
  const hashHex = Array.from(hashArray.slice(0, 20))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const roomCode = `dm-${hashHex}`;
  _dmRoomCodeCache.set(cacheKey, roomCode);
  return roomCode;
}

function loadQueuedDmMessages(): QueuedMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DM_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.to === "string" &&
        Array.isArray(item.data) &&
        typeof item.queuedAt === "number"
    ) as QueuedMessage[];
  } catch {
    return [];
  }
}

function saveQueuedDmMessages(queue: QueuedMessage[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DM_QUEUE_KEY, JSON.stringify(queue));
}

function resolveDmPeerId(candidate: string): string | null {
  if (!candidate) return null;
  // If it's a current peer, use it
  if (_transport.peers().includes(candidate)) return candidate;
  // If it looks like a peer ID, use it
  if (looksLikePeerId(candidate)) return candidate;
  // If it's a DID, try to find the peer ID, but if not found, use the DID itself
  // This is important because DIDs are stable identities
  if (looksLikeDid(candidate)) {
    for (const [peerId, did] of _peerIdToDid) {
      if (did === candidate) return peerId;
    }
    // No mapping found, but it's a valid DID - return it as-is
    // The room code will be computed from the DID which is stable
    return candidate;
  }
  // Try reverse lookup for DID→peerId
  for (const [peerId, did] of _peerIdToDid) {
    if (did === candidate) return peerId;
  }
  return null;
}

function encodeDmChatEnvelope(payload: DmPayload): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = DM_CHAT_TAG;
  out.set(body, 1);
  return out;
}

function queueDmMessage(toDid: string, data: Uint8Array): void {
  const queue = loadQueuedDmMessages();
  queue.push({ to: toDid, data: Array.from(data), queuedAt: Date.now() });
  saveQueuedDmMessages(queue);
}

export function isDmConversation(): boolean {
  return transportState.chatMode === "dm";
}

export async function dmConversationCodeFor(
  peerIdOrDid: string
): Promise<string> {
  const resolvedPeerId = resolveDmPeerId(peerIdOrDid) ?? peerIdOrDid;
  return dmConversationCodeAsync(resolvedPeerId);
}

/**
 * Get the stable DM room code for a conversation with a peer.
 * Uses DIDs (stable identity) not peer IDs (ephemeral).
 */
async function dmConversationCodeAsync(peerIdOrDid: string): Promise<string> {
  const selfDid = identityStore.did ?? _transport.selfId();
  // Resolve to DID if we have a mapping, otherwise use as-is
  const peerDid = _peerIdToDid.get(peerIdOrDid) ?? peerIdOrDid;
  return hashDmRoomCode(selfDid, peerDid);
}

export async function openDmConversation(peerIdOrDid: string): Promise<void> {
  if (!_transport.selfId()) return;
  // Use the input as-is if we can't resolve to a peer ID
  // This supports opening DMs with DIDs directly
  const resolvedPeerId = resolveDmPeerId(peerIdOrDid) ?? peerIdOrDid;
  if (!resolvedPeerId) return;
  const roomCode = await ensureDmRoomForPeer(resolvedPeerId);
  _transport.joinRoom(roomCode);
  await _loadHistory(roomCode);
  transportState.chatMode = "dm";
  transportState.activeDmPeerId = resolvedPeerId;
  transportState.roomCode = roomCode;
  transportState.roomName = resolveDmDisplayName(resolvedPeerId);
  transportState.connected = true;
}

export async function sendDirectMessage(text: string): Promise<void> {
  const peerId = transportState.activeDmPeerId;
  if (!peerId) return;
  const body = text.trim();
  if (!body) return;

  const roomCode = await ensureDmRoomForPeer(peerId);
  _transport.joinRoom(roomCode);

  const id = crypto.randomUUID();
  const ts = Date.now();
  const envelope = encodeDmChatEnvelope({ id, text: body, ts });

  const peerDid = _peerIdToDid.get(peerId) ?? peerId;

  // Resolve to an actual peer ID (not a DID) before checking online status.
  // resolveDmPeerId already handles peerId→peerId and DID→peerId via _peerIdToDid,
  // but falls back to the DID itself when no mapping exists. We need a real peer ID
  // to check _transport.peers(), so we try didToPeerId as a second pass.
  let resolvedPeerId = resolveDmPeerId(peerId);
  if (resolvedPeerId && looksLikeDid(resolvedPeerId)) {
    resolvedPeerId =
      didToPeerId(resolvedPeerId, _peerIdToDid) ?? resolvedPeerId;
  }

  const isOnline =
    !!resolvedPeerId &&
    !looksLikeDid(resolvedPeerId) &&
    _transport.peers().includes(resolvedPeerId);

  if (!isOnline) {
    queueDmMessage(peerDid, envelope);
  } else {
    try {
      await _transport.send(resolvedPeerId!, envelope);
    } catch {
      queueDmMessage(peerDid, envelope);
    }
  }

  const mySenderId = identityStore.did ?? _transport.selfId();
  const msg: Message = {
    id,
    roomCode,
    senderId: mySenderId,
    senderName: "You",
    timestamp: ts,
    lamport: ts,
    type: MessageType.Text,
    content: body,
    attachments: [],
    status: "sent",
  };

  await putMessage(msg);
  await refreshDmRooms();
  transportState.dmVersion += 1;
  if (
    transportState.chatMode === "dm" &&
    transportState.activeDmPeerId === peerId
  ) {
    transportState.messages = [...transportState.messages, msg].sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }
}

export function encodeDmAckEnvelope(messageId: string): Uint8Array {
  const body = new TextEncoder().encode(messageId);
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = DM_ACK_TAG;
  out.set(body, 1);
  return out;
}

export function parseDmEnvelope(
  data: Uint8Array
):
  | { type: "chat"; payload: DmPayload }
  | { type: "ack"; messageId: string }
  | null {
  if (data.byteLength < 1) return null;
  const tag = data[0];
  const payload = data.subarray(1);
  try {
    if (tag === DM_CHAT_TAG) {
      const parsed = JSON.parse(new TextDecoder().decode(payload)) as DmPayload;
      if (
        typeof parsed?.id !== "string" ||
        typeof parsed?.text !== "string" ||
        typeof parsed?.ts !== "number"
      ) {
        return null;
      }
      return { type: "chat", payload: parsed };
    }
    if (tag === DM_ACK_TAG) {
      return { type: "ack", messageId: new TextDecoder().decode(payload) };
    }
  } catch {
    return null;
  }
  return null;
}

export async function flushQueuedDmForPeer(peerId: string): Promise<void> {
  const peerDid = _peerIdToDid.get(peerId);
  if (!peerDid) return; // Can't flush if we don't know their DID yet

  const queue = loadQueuedDmMessages();
  const remaining: QueuedMessage[] = [];
  for (const entry of queue) {
    // Check if message is for this peer (by DID, not peerId)
    if (entry.to !== peerDid) {
      remaining.push(entry);
      continue;
    }
    try {
      await _transport.send(peerId, new Uint8Array(entry.data));
    } catch {
      remaining.push(entry);
    }
  }
  saveQueuedDmMessages(remaining);
}

export function resolveDmDisplayName(peerId: string): string {
  const did = _peerIdToDid.get(peerId);
  if (did)
    return (
      transportState.peerNames.get(did) ??
      transportState.peerNames.get(peerId) ??
      peerId.slice(0, 12)
    );
  return transportState.peerNames.get(peerId) ?? peerId.slice(0, 12);
}

export async function joinPhonebookDmRooms(): Promise<void> {
  const selfDid = identityStore.did ?? _transport.selfId();
  if (!selfDid) return;
  const entries = await getPhonebookEntries();
  for (const entry of entries) {
    const peerDid = resolveToDid(entry.peerId, _peerIdToDid);
    const roomCode = await hashDmRoomCode(selfDid, peerDid);
    _transport.joinRoom(roomCode);
  }
}

export async function ensureDmRoomForPeer(
  peerIdOrDid: string
): Promise<string> {
  const peerDid = resolveToDid(peerIdOrDid, _peerIdToDid);
  const roomCode = await dmConversationCodeAsync(peerIdOrDid);
  const existing = await getRoom(roomCode);
  if (existing) return roomCode;
  const room: DMRoom = {
    roomCode,
    type: "dm",
    name: "",
    lastSeenLamport: 0,
    createdAt: Date.now(),
    participants: [peerDid],
    participantLastSeen: {},
    participantDid: peerDid,
  };
  await putRoom(room);
  return roomCode;
}

export async function addToPhonebook(peerIdOrDid: string): Promise<void> {
  const resolvedPeerId = resolveDmPeerId(peerIdOrDid);
  if (!resolvedPeerId) return;
  const roomCode = await ensureDmRoomForPeer(resolvedPeerId);
  const did = _peerIdToDid.get(resolvedPeerId);
  const profile = did ? await getPeerProfile(did) : undefined;
  await putPhonebookEntry({
    peerId: resolvedPeerId,
    did: did ?? resolvedPeerId,
    nickname: profile?.nickname || resolveDmDisplayName(resolvedPeerId),
    addedAt: Date.now(),
  });
  _transport.joinRoom(roomCode);
}

export async function removeFromPhonebook(peerIdOrDid: string): Promise<void> {
  const resolvedPeerId = resolveDmPeerId(peerIdOrDid) ?? peerIdOrDid;
  await deletePhonebookEntry(resolvedPeerId);
}

export async function removeDmConversation(peerIdOrDid: string): Promise<void> {
  const resolvedPeerId = resolveDmPeerId(peerIdOrDid) ?? peerIdOrDid;
  const allDmRooms = await getDMRooms();

  // Get the canonical room code for this peer
  const canonicalRoomCode = await dmConversationCodeAsync(resolvedPeerId);
  const candidates = new Set<string>([canonicalRoomCode]);

  // Also check rooms by participantDid match
  for (const room of allDmRooms) {
    if (
      room.participantDid === resolvedPeerId ||
      room.participantDid === peerIdOrDid
    ) {
      candidates.add(room.roomCode);
    }
  }

  const queue = loadQueuedDmMessages();
  saveQueuedDmMessages(queue.filter((q) => q.to !== resolvedPeerId));

  // Delete messages for all matching rooms, then delete the rooms
  await Promise.all(
    [...candidates].map(async (roomCode) => {
      await deleteMessagesForRoom(roomCode);
      await deleteRoom(roomCode);
    })
  );

  if (
    transportState.chatMode === "dm" &&
    transportState.activeDmPeerId === resolvedPeerId
  ) {
    transportState.activeDmPeerId = null;
    transportState.roomCode = null;
    transportState.roomName = "";
    transportState.messages = [];
    transportState.chatMode = "room";
    transportState.connected = false;
  }

  transportState.dmVersion += 1;
}
