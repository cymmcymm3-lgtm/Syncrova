const normalizeId = (value) => String(value?._id || value?.id || value || '');

const normalizeMentionName = (value = '') => value
  .toLowerCase()
  .replace(/[^a-z0-9\s._-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const extractMentionTokens = (text = '') => {
  const matches = String(text).match(/@([a-zA-Z0-9._-]+(?:\s+[a-zA-Z0-9._-]+)?)/g) || [];
  return [...new Set(matches.map(match => normalizeMentionName(match.slice(1))).filter(Boolean))];
};

const getMentionedMemberIds = async (group, text = '') => {
  if (!group || !text) return [];
  if (typeof group.populate === 'function') {
    await group.populate('members', 'name email');
  }

  const tokens = extractMentionTokens(text);
  if (!tokens.length) return [];

  const mentioned = new Set();
  (group.members || []).forEach(member => {
    const memberName = normalizeMentionName(member?.name || '');
    const firstName = normalizeMentionName((member?.name || '').split(/\s+/)[0] || '');
    const emailName = normalizeMentionName((member?.email || '').split('@')[0] || '');

    if (tokens.some(token => token === memberName || token === firstName || token === emailName)) {
      mentioned.add(normalizeId(member));
    }
  });

  return [...mentioned];
};

module.exports = {
  getMentionedMemberIds
};
