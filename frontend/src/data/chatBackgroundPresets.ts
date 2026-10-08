type ChatBackgroundConfig = {
  label: string;
  description: string;
  className: string;
  preview: string;
  image?: string;
};

type CreateImageOptions = {
  extension?: string;
  className?: string;
};

const asset = (index: number, extension = 'jpeg'): string =>
  `/conversation-backgrounds/conversation-bg-${String(index).padStart(2, '0')}.${extension}`;

const createImageBackground = (
  index: number,
  label: string,
  description: string,
  options: CreateImageOptions = {},
): ChatBackgroundConfig => {
  const image = asset(index, options.extension);
  return {
    label,
    description,
    className: options.className || 'chat-bg-image',
    image,
    preview: `url("${image}") center / cover no-repeat`
  };
};

export const CHAT_BACKGROUNDS: Record<string, ChatBackgroundConfig> = {
  default: {
    label: 'Default',
    description: 'Clean Syncrova surface',
    className: 'chat-bg-default',
    preview: 'linear-gradient(135deg, #f8fafc, #eef2f7)'
  },
  'local-bg-01': createImageBackground(1, 'City Glow', 'Crisp neon chat pattern', {
    extension: 'svg',
    className: 'chat-bg-image chat-bg-tile'
  }),
  'local-bg-02': createImageBackground(2, 'Anime Dusk', 'Soft cinematic dusk wallpaper'),
  'local-bg-03': createImageBackground(3, 'Neon Study', 'Dark neon study vibe'),
  'local-bg-04': createImageBackground(4, 'Glitch Lines', 'Graphic dark chat texture'),
  'local-bg-05': createImageBackground(5, 'Dream Park', 'Playful illustrated scene'),
  'local-bg-06': createImageBackground(6, 'Blue Depth', 'Deep blue mobile wallpaper'),
  'local-bg-07': createImageBackground(7, 'Pastel Sky', 'Light pastel conversation view'),
  'local-bg-08': createImageBackground(8, 'Cyber Street', 'High contrast cyber mood'),
  'local-bg-09': createImageBackground(9, 'Calm Horizon', 'Clean vertical horizon art'),
  'local-bg-10': createImageBackground(10, 'Warm Abstract', 'Soft warm abstract picture'),
  'local-bg-11': createImageBackground(11, 'Night Field', 'Quiet dark landscape'),
  'local-bg-12': createImageBackground(12, 'Blue Sketch', 'Cool graphic chat wallpaper'),
  'local-bg-13': createImageBackground(13, 'Cosmic Shade', 'Dark cosmic phone wallpaper'),
  'local-bg-14': createImageBackground(14, 'Noura', 'Minimal aesthetic wallpaper'),
  'local-bg-15': createImageBackground(15, 'Black Mood', 'Deep black aesthetic wallpaper'),
  'local-bg-16': createImageBackground(16, 'White Mood', 'Bright clean aesthetic wallpaper')
};

export const CHAT_BACKGROUND_OPTIONS = Object.entries(CHAT_BACKGROUNDS).map(([id, value]) => ({
  id,
  ...value
}));

export const DEFAULT_CHAT_BACKGROUND_ID = 'default';

export const getChatBackground = (id?: string): ChatBackgroundConfig =>
  CHAT_BACKGROUNDS[id || ''] || CHAT_BACKGROUNDS[DEFAULT_CHAT_BACKGROUND_ID];
