//! `protocols/acp/acp-limits.mjs`.

/// Keeps base64 image blocks and their JSON envelope below the 1 MiB JSONL frame.
pub const ACP_INLINE_IMAGE_MAX_BYTES: u64 = 512 * 1024;
