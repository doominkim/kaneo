import { HTTPException } from "hono/http-exception";

/** feature slug — same shape as document slugs */
export const FEATURE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** REQ-<FEATURE>-<n>: FEATURE is the slug upper-cased, n ≥ 1 */
export const KEY_PATTERN = /^REQ-([A-Z0-9]+(?:-[A-Z0-9]+)*)-(\d+)$/;

/** `basic-info-approval` → `BASIC-INFO-APPROVAL` */
export function keyPrefixOf(feature: string): string {
  return feature.toUpperCase();
}

export function buildKey(feature: string, seq: number): string {
  return `REQ-${keyPrefixOf(feature)}-${seq}`;
}

/**
 * A key is only valid inside its own feature: `REQ-ADMIN-QA-3` cannot be
 * filed under feature `spec-tabs`. Returns the seq so the caller can keep
 * `nextSeq` ahead of explicitly supplied keys (migration imports numbers).
 */
export function parseKey(key: string, feature: string): { seq: number } {
  const match = KEY_PATTERN.exec(key);
  if (!match) {
    throw new HTTPException(400, {
      message: `key must match REQ-<FEATURE>-<n>: ${key}`,
    });
  }
  if (match[1] !== keyPrefixOf(feature)) {
    throw new HTTPException(400, {
      message: `key ${key} does not belong to feature ${feature}`,
    });
  }
  const seq = Number(match[2]);
  if (!Number.isInteger(seq) || seq < 1) {
    throw new HTTPException(400, { message: `key seq must be ≥ 1: ${key}` });
  }
  return { seq };
}
