/**
 * Shared model types for the Syncrova frontend.
 *
 * These mirror the shapes returned by the backend's REST endpoints. They are
 * intentionally permissive (most fields optional) because the migration is
 * incremental: JS callers still pass partial objects in many places, and we
 * don't want strict typing to block adoption. Tighten fields as each domain
 * is fully migrated.
 *
 * Convention: Mongo documents expose `_id`; some normalized payloads also
 * expose `id`. Helpers like `getEntityId` accept either.
 */

/** A reference to anything that may carry an identifier — string id, Mongo doc, or normalized object. */
export type EntityRef = string | { _id?: string; id?: string } | null | undefined;

/** Minimal user shape used across auth/presence/messaging. Extend per-feature as needed. */
export interface User {
  _id?: string;
  id?: string;
  name?: string;
  email?: string;
  username?: string;
  avatar?: string;
  profilePicture?: string;
  role?: string;
  lastSeen?: string | number | Date;
  /** Backend frequently adds ad-hoc fields; allow them without `any`. */
  [key: string]: unknown;
}

/** A condensed "public" user view returned by `/users/:id/public`. */
export type PublicUser = User;

/** Story document as returned by `/stories/active*`. */
export interface Story {
  _id?: string;
  id?: string;
  userId?: EntityRef;
  createdAt?: string | number | Date;
  expiresAt?: string | number | Date;
  [key: string]: unknown;
}

/** Grouped active stories keyed by owner. */
export interface StoryGroup {
  userId?: EntityRef;
  user?: User;
  stories: Story[];
  [key: string]: unknown;
}

/** In-app / push notification payload from `/notifications` and socket events. */
export interface AppNotification {
  _id?: string;
  id?: string;
  type?: string;
  title?: string;
  body?: string;
  href?: string;
  /** Stable server-side identity for a notification that can be updated in place. */
  dedupeKey?: string;
  actorId?: string;
  fromId?: string;
  senderId?: string;
  read?: boolean;
  createdAt?: string | number | Date;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Resolve Mongo `_id` or normalized `id` from common entity shapes. */
export const getEntityId = (entity: EntityRef): string => {
  if (!entity) return '';
  if (typeof entity === 'string') return entity;
  return String(entity._id || entity.id || '');
};
