import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAT_FLAGS_KEY = 'syncrova.nativeMessenger.chatFlags';
const CHAT_THEMES_KEY = 'syncrova.nativeMessenger.chatThemes';

export type ChatFlagKey = 'pinned' | 'muted' | 'favorites';

export type ChatFlagState = Record<ChatFlagKey, string[]>;

const emptyFlags: ChatFlagState = {
  pinned: [],
  muted: [],
  favorites: []
};

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

export const loadChatFlags = async (): Promise<ChatFlagState> => {
  const raw = await AsyncStorage.getItem(CHAT_FLAGS_KEY);
  if (!raw) return emptyFlags;

  try {
    const parsed = JSON.parse(raw) as Partial<ChatFlagState>;
    return {
      pinned: unique(parsed.pinned || []),
      muted: unique(parsed.muted || []),
      favorites: unique(parsed.favorites || [])
    };
  } catch {
    return emptyFlags;
  }
};

export const saveChatFlags = async (flags: ChatFlagState) => {
  await AsyncStorage.setItem(CHAT_FLAGS_KEY, JSON.stringify({
    pinned: unique(flags.pinned),
    muted: unique(flags.muted),
    favorites: unique(flags.favorites)
  }));
};

export const toggleChatFlag = (flags: ChatFlagState, flag: ChatFlagKey, chatId: string): ChatFlagState => {
  const values = new Set(flags[flag] || []);
  if (values.has(chatId)) values.delete(chatId);
  else values.add(chatId);
  return { ...flags, [flag]: Array.from(values) };
};

export const hasChatFlag = (flags: ChatFlagState, flag: ChatFlagKey, chatId?: string) => (
  Boolean(chatId && flags[flag]?.includes(chatId))
);

export const loadChatThemes = async (): Promise<Record<string, string>> => {
  const raw = await AsyncStorage.getItem(CHAT_THEMES_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
};

export const saveChatTheme = async (chatId: string, themeId: string) => {
  const themes = await loadChatThemes();
  const next = { ...themes, [chatId]: themeId };
  await AsyncStorage.setItem(CHAT_THEMES_KEY, JSON.stringify(next));
  return next;
};
