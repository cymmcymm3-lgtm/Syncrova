export const getEntityId = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const record = value as { _id?: unknown; id?: unknown };
    return String(record._id || record.id || '');
  }
  return '';
};

export const getMessageKey = (
  message: { _id?: string; id?: string; clientId?: string; createdAt?: string; text?: string },
  index = 0
) => (
  getEntityId(message) ||
  message.clientId ||
  `${message.createdAt || 'message'}:${String(message.text || '').slice(0, 16)}:${index}`
);
