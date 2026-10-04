/**
 * SSR-safe identifier generation.
 *
 * `crypto.randomUUID` is preferred when the runtime exposes it (all evergreen
 * browsers and Node >= 19); otherwise a collision-resistant base-36 fallback is
 * used so the module never throws during prerendering or static analysis.
 */
export function generateEntityId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

/** Same contract as {@link generateEntityId} with an explicit prefix. */
export function generatePrefixedId(prefix: string): string {
  return generateEntityId(prefix);
}

/**
 * Convert arbitrary text into an asset-name-safe slug.
 * Keeps only alphanumerics, hyphens and underscores, as required by the
 * `^[a-zA-Z0-9-_]{3,64}$` validation rule.
 */
export function slugifyAssetName(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Deterministic prefix list so ids stay greppable in the console. */
export const ID_PREFIXES = {
  server: 'srv',
  alarm: 'alm',
  incident: 'inc',
  event: 'evt',
  log: 'log'
} as const;
