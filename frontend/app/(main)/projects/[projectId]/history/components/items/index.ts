/**
 * Side-effect import barrel for Needs Action kinds.
 *
 * Each kind module ``registerKind`` at module-eval time. The Section
 * component imports this barrel so the registry is populated in a
 * predictable order before it iterates kinds.
 *
 * Adding a new plugin kind = add one ``import`` line here. The kind's
 * registration runs as a side effect; nothing else changes.
 */
import './pendingReviewKind';
import './conflictKind';
import './failedSyncKind';
import './riskyDeleteKind';
