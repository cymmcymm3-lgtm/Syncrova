import { BadgeCheck, Code2 } from 'lucide-react';
import './developer-identity.css';

/**
 * The API exposes `isDeveloper` for trusted developer accounts. The extra
 * admin checks make the visual identity future-proof without granting any
 * access in the client; all authorisation still happens on the server.
 */
export const isDeveloperUser = (user) => Boolean(
  user?.isDeveloper
  || user?.isAdmin
  || user?.role === 'admin'
  || user?.role === 'developer'
);

const getIdentityLabel = (user) => (
  user?.isAdmin || user?.role === 'admin' ? 'Admin' : 'Dev'
);

/** A small, readable identity tag that can sit beside a member name. */
export function DeveloperBadge({ user, compact = false, className = '' }) {
  if (!isDeveloperUser(user)) return null;

  const label = getIdentityLabel(user);

  if (compact) {
    return (
      <span
        className={`sync-developer-badge sync-developer-badge--compact ${className}`}
        title={`${label} account`}
        aria-label={`${label} account`}
      >
        <Code2 size={10} strokeWidth={2.5} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`sync-developer-badge ${className}`}
      title={`${label} account`}
    >
      <Code2 size={12} strokeWidth={2.5} aria-hidden="true" />
      <span>{label}</span>
      <BadgeCheck size={12} aria-hidden="true" />
    </span>
  );
}

/**
 * Applies a restrained blue frame only to developer/admin photos. The image
 * remains entirely unobstructed; the small Dev chip sits outside the photo.
 */
export function DeveloperAvatarFrame({ user, children, className = '' }) {
  const developer = isDeveloperUser(user);
  const label = getIdentityLabel(user);

  return (
    <span
      className={`sync-developer-avatar ${developer ? 'sync-developer-avatar--verified' : ''} ${className}`.trim()}
    >
      {children}
      {developer && (
        <span className="sync-developer-avatar__chip" aria-label={`${label} account`}>
          {label === 'Admin' ? 'AD' : 'DEV'}
        </span>
      )}
    </span>
  );
}

export function DeveloperName({ user, children, compact = false, className = '' }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`.trim()}>
      <span className="min-w-0 truncate">{children || user?.name || 'Member'}</span>
      <DeveloperBadge user={user} compact={compact} />
    </span>
  );
}
