# Chunking Protocol v1.0

## Alignment

PuppyFlow (TypeScript) ↔ PuppyEngine (Python)

## Constants

- Chunk size: 1MB (1,048,576 bytes)
- Structured: `.jsonl` (one JSON object per line)
- Text: `.txt` (UTF-8)
- Naming: `chunk_000000.ext`, `chunk_000001.ext`

## Rules

### Structured

1. Parse JSON array
2. Split by records, respect size limit
3. Never split single object
4. If object > 1MB, dedicated chunk

### Text

1. Split by bytes
2. May split mid-word

## Backend Match

Python (`ExternalStorageStrategy.py` line 313-317):

```python
chunk_size = 1024 * 1024
for i in range(0, len(text_bytes), self.chunk_size):
    chunk = text_bytes[i:i + self.chunk_size]
    yield f"chunk_{chunk_index:06d}.txt", chunk
```

TypeScript (must match):

```typescript
CHUNK_SIZE = 1024 * 1024
chunkName = `chunk_${index.toString().padStart(6, '0')}.txt`
```

## Example

Input (structured):

```json
[{"id": 1, "data": "..."}, {"id": 2, "data": "..."}]
```

Output:

```
chunk_000000.jsonl:
{"id": 1, "data": "..."}
{"id": 2, "data": "..."}
```

Both PuppyEngine and PuppyFlow must produce identical chunks for same input.

## Verification

Same input → Same number of chunks → Same naming → Compatible format

