/**
 * Migration integrity verification.
 *
 * Lazy migration is COPY + VERIFY, never move: after the legacy bytes are
 * copied into the native backend we read them back and compare the recomputed
 * SHA-256 (and byte length) against the legacy record. Any mismatch means the
 * native copy is NOT trusted and the legacy backend stays authoritative.
 */
import { sha256Hex } from '../attachments/hash.js';

/**
 * Compare the SHA-256 of the given bytes against the expected digest.
 * Returns `false` on any mismatch (also when the digest format differs).
 */
export function verifyFileIntegrity(
  data: Uint8Array,
  expectedSha256: string,
): boolean {
  return sha256Hex(data) === expectedSha256;
}

export interface ReadBackVerifiedOptions {
  /** Read the (native) bytes back for verification. */
  readBack: () => Promise<Uint8Array>;
  /** Expected SHA-256; verification fails on mismatch. */
  expectedSha256: string;
  /** Expected byte length; a length mismatch also fails verification. */
  expectedBytes?: number;
}

/**
 * Read the copied bytes back and verify them: any read-back failure, byte
 * length mismatch (when `expectedBytes` is given) or hash mismatch returns
 * `false` — the migration must then stay legacy-authoritative.
 */
export async function readBackVerified(
  options: ReadBackVerifiedOptions,
): Promise<boolean> {
  let data: Uint8Array;
  try {
    data = await options.readBack();
  } catch {
    return false;
  }
  if (options.expectedBytes !== undefined && data.byteLength !== options.expectedBytes) {
    return false;
  }
  return verifyFileIntegrity(data, options.expectedSha256);
}