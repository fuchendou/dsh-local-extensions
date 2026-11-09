/**
 * One-version compatibility shim.
 *
 * The QQ inbound hydrator was renamed from `image-hydrator.ts` to
 * `media-hydrator.ts` (it now covers image / file / audio / video). This entry
 * re-exports the new implementation under the legacy names so existing imports
 * of `hydrateImageParts` / `ImageHydratorOptions` keep working for one release.
 *
 * New code should import `hydrateMediaParts` / `MediaHydratorOptions` from
 * `./media-hydrator.js`.
 */
export {
  hydrateMediaParts as hydrateImageParts,
  type MediaHydratorOptions as ImageHydratorOptions,
} from './media-hydrator.js';