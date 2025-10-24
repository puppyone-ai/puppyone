/**
 * ChunkingService - Protocol-compliant chunking
 *
 * Aligned with PuppyEngine's ExternalStorageStrategy.py
 * See CHUNKING_SPEC.md for protocol details
 */

export const CHUNK_SIZE = 1024 * 1024; // 1MB - matches Python backend

export interface ChunkDescriptor {
  name: string; // e.g., "chunk_000000.jsonl"
  mime: string; // e.g., "application/jsonl"
  bytes: Uint8Array;
  index: number;
}

export class ChunkingService {
  /**
   * Chunk content according to protocol
   */
  static chunk(
    content: string,
    contentType: 'text' | 'structured'
  ): ChunkDescriptor[] {
    return contentType === 'structured'
      ? this.chunkStructured(content)
      : this.chunkText(content);
  }

  private static chunkStructured(content: string): ChunkDescriptor[] {
    const encoder = new TextEncoder();

    try {
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        // Single object
        return [this.makeChunk([parsed], 0, encoder)];
      }

      // Array - chunk by size
      const chunks: ChunkDescriptor[] = [];
      let current: any[] = [];
      let size = 0;
      let idx = 0;

      for (const item of parsed) {
        const itemStr = JSON.stringify(item) + '\n';
        const itemSize = encoder.encode(itemStr).length;

        // Single item exceeds chunk size
        if (itemSize > CHUNK_SIZE) {
          if (current.length > 0) {
            chunks.push(this.makeChunk(current, idx++, encoder));
            current = [];
            size = 0;
          }
          chunks.push(this.makeChunk([item], idx++, encoder));
          continue;
        }

        // Would exceed if added
        if (size + itemSize > CHUNK_SIZE && current.length > 0) {
          chunks.push(this.makeChunk(current, idx++, encoder));
          current = [];
          size = 0;
        }

        current.push(item);
        size += itemSize;
      }

      // Last chunk
      if (current.length > 0) {
        chunks.push(this.makeChunk(current, idx, encoder));
      }

      return chunks;
    } catch {
      // Parse failed, treat as text
      return this.chunkText(content);
    }
  }

  private static chunkText(content: string): ChunkDescriptor[] {
    const encoder = new TextEncoder();
    const chunks: ChunkDescriptor[] = [];

    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const idx = Math.floor(i / CHUNK_SIZE);
      chunks.push({
        name: `chunk_${String(idx).padStart(6, '0')}.txt`,
        mime: 'text/plain; charset=utf-8',
        bytes: encoder.encode(content.slice(i, i + CHUNK_SIZE)),
        index: idx,
      });
    }

    return chunks;
  }

  private static makeChunk(
    items: any[],
    idx: number,
    encoder: TextEncoder
  ): ChunkDescriptor {
    const jsonl = items.map(o => JSON.stringify(o)).join('\n') + '\n';

    return {
      name: `chunk_${String(idx).padStart(6, '0')}.jsonl`,
      mime: 'application/jsonl',
      bytes: encoder.encode(jsonl),
      index: idx,
    };
  }
}
