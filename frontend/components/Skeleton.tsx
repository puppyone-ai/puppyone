/**
 * Legacy compatibility shim.
 *
 * The unified loading system lives at `components/loading/`. This
 * file exists ONLY so existing imports — `import { EditorSkeleton }
 * from '@/components/Skeleton'` — keep compiling while we migrate
 * call-sites. New code MUST import from `@/components/loading`:
 *
 *   import { Skeleton } from '@/components/loading';
 *   <Skeleton.Editor />
 *
 * This file is safe to delete once the legacy import is gone from
 * the tree (Grep `components/Skeleton'` to find remaining call-sites).
 */

export { SkeletonEditor as EditorSkeleton } from './loading/Skeleton';
