const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

export const formatConversationTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diff = Date.now() - date.getTime();
  if (diff < minute) return 'Now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const formatMessageTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const isSameDate = (left: Date, right: Date) => (
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()
);

export const formatActiveStatus = ({
  online,
  lastSeen
}: {
  online?: boolean;
  lastSeen?: string | null;
}) => {
  if (online) return 'Active now';
  if (!lastSeen) return 'Offline';

  const date = new Date(lastSeen);
  if (Number.isNaN(date.getTime())) return 'Offline';

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < minute) return 'Active just now';
  if (diff < hour) return `Active ${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `Active ${Math.floor(diff / hour)}h ago`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDate(date, yesterday)) {
    return `Active yesterday at ${formatMessageTime(lastSeen)}`;
  }

  if (diff < 7 * day) {
    return `Active ${date.toLocaleDateString(undefined, { weekday: 'long' })}`;
  }

  return `Active ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${formatMessageTime(lastSeen)}`;
};
