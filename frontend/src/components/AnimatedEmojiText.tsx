import React, { useMemo, useState } from 'react';

const EMOJI_PATTERN = /(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|\p{Emoji_Presentation})/gu;

const emojiToNotoCode = (emoji = '') => (
  Array.from(emoji)
    .map(char => char.codePointAt(0)?.toString(16))
    .filter(code => code && code !== 'fe0f' && code !== 'fe0e')
    .join('_')
);

function AnimatedEmoji({ emoji }) {
  const [failed, setFailed] = useState(false);
  const code = emojiToNotoCode(emoji);

  if (!code || failed) return <span>{emoji}</span>;

  return (
    <img
      src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp`}
      alt={emoji}
      className="animated-noto-emoji developer-motion-zone"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export default function AnimatedEmojiText({ text = '', className = '' }) {
  const parts = useMemo(() => {
    const value = String(text || '');
    if (!value) return [];
    const matches = [...value.matchAll(EMOJI_PATTERN)];
    if (!matches.length) return [value];

    const next = [];
    let cursor = 0;
    matches.forEach((match) => {
      const index = match.index ?? 0;
      if (index > cursor) next.push(value.slice(cursor, index));
      next.push({ emoji: match[0], key: `${index}-${match[0]}` });
      cursor = index + match[0].length;
    });
    if (cursor < value.length) next.push(value.slice(cursor));
    return next;
  }, [text]);

  if (!parts.length) return null;

  return (
    <span className={className}>
      {parts.map((part, index) => (
        typeof part === 'string'
          ? <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
          : <AnimatedEmoji key={part.key} emoji={part.emoji} />
      ))}
    </span>
  );
}
