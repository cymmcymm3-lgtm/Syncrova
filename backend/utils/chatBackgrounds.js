const CHAT_BACKGROUND_IDS = [
  'default',
  'local-bg-01',
  'local-bg-02',
  'local-bg-03',
  'local-bg-04',
  'local-bg-05',
  'local-bg-06',
  'local-bg-07',
  'local-bg-08',
  'local-bg-09',
  'local-bg-10',
  'local-bg-11',
  'local-bg-12',
  'local-bg-13',
  'local-bg-14',
  'local-bg-15',
  'local-bg-16'
];

const DEFAULT_CHAT_BACKGROUND_ID = 'default';
const CHAT_BACKGROUND_ID_SET = new Set(CHAT_BACKGROUND_IDS);

const normalizeChatBackgroundId = (value = '') => {
  const id = String(value || '').trim();
  return CHAT_BACKGROUND_ID_SET.has(id) ? id : '';
};

module.exports = {
  CHAT_BACKGROUND_IDS,
  DEFAULT_CHAT_BACKGROUND_ID,
  normalizeChatBackgroundId
};
