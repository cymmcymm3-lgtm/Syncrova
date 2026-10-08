import { create } from 'zustand';

export type PresenceStatus = {
  online: boolean;
  lastSeen?: string | null;
  updatedAt: number;
};

type PresenceState = {
  connected: boolean;
  onlineUserIds: string[];
  statuses: Record<string, PresenceStatus>;
  typingByChat: Record<string, string[]>;
  setConnected: (connected: boolean) => void;
  setOnlineUsers: (userIds: string[]) => void;
  setUserStatus: (userId: string, online: boolean, lastSeen?: string | null) => void;
  setTyping: (chatId: string, userId: string, typing: boolean) => void;
  clearTypingForUser: (userId: string) => void;
  resetPresence: () => void;
};

const normalizeId = (value?: unknown) => String((value as { _id?: string; id?: string; userId?: string })?._id || (value as { id?: string; userId?: string })?.id || (value as { userId?: string })?.userId || value || '');

export const usePresenceStore = create<PresenceState>((set) => ({
  connected: false,
  onlineUserIds: [],
  statuses: {},
  typingByChat: {},
  setConnected: connected => set({ connected }),
  setOnlineUsers: userIds => set(state => {
    const nextIds = Array.from(new Set(userIds.map(normalizeId).filter(Boolean)));
    const nextSet = new Set(nextIds);
    const now = Date.now();
    const statuses = { ...state.statuses };

    nextIds.forEach(userId => {
      statuses[userId] = {
        online: true,
        lastSeen: statuses[userId]?.lastSeen || null,
        updatedAt: now
      };
    });

    Object.keys(statuses).forEach(userId => {
      if (statuses[userId]?.online && !nextSet.has(userId)) {
        statuses[userId] = {
          ...statuses[userId],
          online: false,
          updatedAt: now
        };
      }
    });

    return { onlineUserIds: nextIds, statuses };
  }),
  setUserStatus: (userId, online, lastSeen) => set(state => {
    const id = normalizeId(userId);
    if (!id) return state;

    const onlineSet = new Set(state.onlineUserIds);
    if (online) onlineSet.add(id);
    else onlineSet.delete(id);

    return {
      onlineUserIds: Array.from(onlineSet),
      statuses: {
        ...state.statuses,
        [id]: {
          online,
          lastSeen: lastSeen ?? state.statuses[id]?.lastSeen ?? null,
          updatedAt: Date.now()
        }
      }
    };
  }),
  setTyping: (chatId, userId, typing) => set(state => {
    const normalizedChatId = normalizeId(chatId);
    const normalizedUserId = normalizeId(userId);
    if (!normalizedChatId || !normalizedUserId) return state;

    const currentTypers = new Set(state.typingByChat[normalizedChatId] || []);
    if (typing) currentTypers.add(normalizedUserId);
    else currentTypers.delete(normalizedUserId);

    const typingByChat = { ...state.typingByChat };
    if (currentTypers.size) typingByChat[normalizedChatId] = Array.from(currentTypers);
    else delete typingByChat[normalizedChatId];

    return { typingByChat };
  }),
  clearTypingForUser: userId => set(state => {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) return state;

    let changed = false;
    const typingByChat = { ...state.typingByChat };

    Object.entries(typingByChat).forEach(([chatId, typers]) => {
      const nextTypers = typers.filter(typerId => typerId !== normalizedUserId);
      if (nextTypers.length !== typers.length) changed = true;
      if (nextTypers.length) typingByChat[chatId] = nextTypers;
      else delete typingByChat[chatId];
    });

    return changed ? { typingByChat } : state;
  }),
  resetPresence: () => set({
    connected: false,
    onlineUserIds: [],
    statuses: {},
    typingByChat: {}
  })
}));
