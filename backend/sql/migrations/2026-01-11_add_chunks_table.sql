-- Migration: Add chunks table for chunking core
-- Date: 2026-01-11
-- Description: Persist chunked segments for large strings stored in context_table.data

\i ../chunks.sql

comment on table public.chunks is 'Persisted text chunks for large JSON string nodes (table_id + json_pointer)';
comment on column public.chunks.json_pointer is 'RFC6901 JSON Pointer locating the original string node';
comment on column public.chunks.chunk_index is '0-based chunk ordering index within the same node and content_hash';
comment on column public.chunks.total_chunks is 'Total number of chunks for the same node and content_hash';
comment on column public.chunks.char_start is 'Start offset (inclusive) in the original full string';
comment on column public.chunks.char_end is 'End offset (exclusive) in the original full string';
comment on column public.chunks.content_hash is 'SHA256 of the original full string content';

