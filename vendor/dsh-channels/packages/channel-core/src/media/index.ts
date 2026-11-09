/**
 * Secure host boundary for remote binary media plus the
 * protocol-neutral binary hydration helper.
 *
 * `@wsz987/channel-core/media` exports the pure bounded stream reader, the
 * pure SSRF/URL policy, the `SecureRemoteMediaFetcher` that ties them
 * together over an injectable fetch, the pure MIME hint helpers, and the
 * protocol-agnostic `applyHydrationResult` / `isHydratableBinaryPart`.
 * None of these modules perform network I/O by themselves; the fetcher is
 * the single seam that does.
 */
export * from './bounded-response.js';
export * from './hydration.js';
export * from './mime-hint.js';
export * from './remote-policy.js';
export * from './secure-fetcher.js';
