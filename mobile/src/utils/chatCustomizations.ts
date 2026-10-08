import { ImageSourcePropType, StyleProp, ViewStyle } from 'react-native';

export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

export type ChatTheme = {
  id: string;
  label: string;
  ownBubble: string;
  accent: string;
};

export const CHAT_THEMES: ChatTheme[] = [
  { id: 'messenger', label: 'Messenger', ownBubble: '#0A7CFF', accent: '#0A7CFF' },
  { id: 'rose', label: 'Rose', ownBubble: '#DB2777', accent: '#DB2777' },
  { id: 'mint', label: 'Mint', ownBubble: '#059669', accent: '#059669' },
  { id: 'ember', label: 'Ember', ownBubble: '#EA580C', accent: '#EA580C' },
  { id: 'midnight', label: 'Midnight', ownBubble: '#111827', accent: '#111827' }
];

export type ChatBackground = {
  id: string;
  label: string;
  style: StyleProp<ViewStyle>;
  swatch: string;
  image?: ImageSourcePropType;
};

export const DEFAULT_BACKGROUND_ID = 'default';

export const CHAT_BACKGROUNDS: ChatBackground[] = [
  { id: 'default', label: 'Clean', swatch: '#F1F5F9', style: { backgroundColor: '#F1F5F9' } },
  { id: 'local-bg-01', label: 'Sky', swatch: '#DBEAFE', style: { backgroundColor: '#DBEAFE' }, image: require('../../assets/conversation-backgrounds/conversation-bg-01.jpeg') },
  { id: 'local-bg-02', label: 'Bloom', swatch: '#FCE7F3', style: { backgroundColor: '#FCE7F3' }, image: require('../../assets/conversation-backgrounds/conversation-bg-02.jpeg') },
  { id: 'local-bg-03', label: 'Mint', swatch: '#DCFCE7', style: { backgroundColor: '#DCFCE7' }, image: require('../../assets/conversation-backgrounds/conversation-bg-03.jpeg') },
  { id: 'local-bg-04', label: 'Paper', swatch: '#F8FAFC', style: { backgroundColor: '#F8FAFC' }, image: require('../../assets/conversation-backgrounds/conversation-bg-04.jpeg') },
  { id: 'local-bg-05', label: 'Lilac', swatch: '#EDE9FE', style: { backgroundColor: '#EDE9FE' }, image: require('../../assets/conversation-backgrounds/conversation-bg-05.jpeg') },
  { id: 'local-bg-06', label: 'Peach', swatch: '#FFEDD5', style: { backgroundColor: '#FFEDD5' }, image: require('../../assets/conversation-backgrounds/conversation-bg-06.jpeg') },
  { id: 'local-bg-07', label: 'Aqua', swatch: '#CCFBF1', style: { backgroundColor: '#CCFBF1' }, image: require('../../assets/conversation-backgrounds/conversation-bg-07.jpeg') },
  { id: 'local-bg-08', label: 'Slate', swatch: '#E2E8F0', style: { backgroundColor: '#E2E8F0' }, image: require('../../assets/conversation-backgrounds/conversation-bg-08.jpeg') },
  { id: 'local-bg-09', label: 'Night', swatch: '#111827', style: { backgroundColor: '#111827' }, image: require('../../assets/conversation-backgrounds/conversation-bg-09.jpeg') },
  { id: 'local-bg-10', label: 'Coral', swatch: '#FFE4E6', style: { backgroundColor: '#FFE4E6' }, image: require('../../assets/conversation-backgrounds/conversation-bg-10.jpeg') },
  { id: 'local-bg-11', label: 'Cobalt', swatch: '#BFDBFE', style: { backgroundColor: '#BFDBFE' }, image: require('../../assets/conversation-backgrounds/conversation-bg-11.jpeg') },
  { id: 'local-bg-12', label: 'Lime', swatch: '#ECFCCB', style: { backgroundColor: '#ECFCCB' }, image: require('../../assets/conversation-backgrounds/conversation-bg-12.jpeg') },
  { id: 'local-bg-13', label: 'Fog', swatch: '#E5E7EB', style: { backgroundColor: '#E5E7EB' }, image: require('../../assets/conversation-backgrounds/conversation-bg-13.jpeg') },
  { id: 'local-bg-14', label: 'Gold', swatch: '#FEF3C7', style: { backgroundColor: '#FEF3C7' }, image: require('../../assets/conversation-backgrounds/conversation-bg-14.jpeg') },
  { id: 'local-bg-15', label: 'Violet', swatch: '#DDD6FE', style: { backgroundColor: '#DDD6FE' }, image: require('../../assets/conversation-backgrounds/conversation-bg-15.jpeg') },
  { id: 'local-bg-16', label: 'Graphite', swatch: '#1F2937', style: { backgroundColor: '#1F2937' }, image: require('../../assets/conversation-backgrounds/conversation-bg-16.jpeg') }
];

export const getThemeById = (id?: string) => CHAT_THEMES.find(theme => theme.id === id) || CHAT_THEMES[0];

export const getBackgroundById = (id?: string) => (
  CHAT_BACKGROUNDS.find(background => background.id === id) || CHAT_BACKGROUNDS[0]
);
