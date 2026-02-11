/**
 * PartitioningService - Protocol-compliant partitioning
 *
 * Aligned with PuppyEngine's ExternalStorageStrategy.py
 * See STORAGE_SPEC.md for protocol details
 */

export const PART_SIZE = 1024 * 1024; // 1MB - matches Python backend

export interface PartDescriptor {
  name: string; // e.g., "part_000000.jsonl"
  mime: string; // e.g., "application/jsonl"
  bytes: Uint8Array;
  index: number;
}

export class PartitioningService {
  /**
   * Partition content according to protocol
   */
  static partition(
    content: string,
    contentType: 'text' | 'structured'
  ): PartDescriptor[] {
    return contentType === 'structured'
      ? this.partitionStructured(content)
      : this.partitionText(content);
  }

  private static partitionStructured(content: string): PartDescriptor[] {
    const encoder = new TextEncoder();

    try {
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        // Single object
        return [this.makePart([parsed], 0, encoder)];
      }

      // Array - partition by size
      const parts: PartDescriptor[] = [];
      let current: any[] = [];
      let size = 0;
      let idx = 0;

      for (const item of parsed) {
        const itemStr = JSON.stringify(item) + '\n';
        const itemSize = encoder.encode(itemStr).length;

        // Single item exceeds part size
        if (itemSize > PART_SIZE) {
          if (current.length > 0) {
            parts.push(this.makePart(current, idx++, encoder));
            current = [];
            size = 0;
          }
          parts.push(this.makePart([item], idx++, encoder));
          continue;
        }

        // Would exceed if added
        if (size + itemSize > PART_SIZE && current.length > 0) {
          parts.push(this.makePart(current, idx++, encoder));
          current = [];
          size = 0;
        }

        current.push(item);
        size += itemSize;
      }

      // Last part
      if (current.length > 0) {
        parts.push(this.makePart(current, idx, encoder));
      }

      return parts;
    } catch {
      // Parse failed, treat as text
      return this.partitionText(content);
    }
  }

  private static partitionText(content: string): PartDescriptor[] {
    const encoder = new TextEncoder();
    const parts: PartDescriptor[] = [];

    for (let i = 0; i < content.length; i += PART_SIZE) {
      const idx = Math.floor(i / PART_SIZE);
      parts.push({
        name: `part_${String(idx).padStart(6, '0')}.txt`,
        mime: 'text/plain; charset=utf-8',
        bytes: encoder.encode(content.slice(i, i + PART_SIZE)),
        index: idx,
      });
    }

    return parts;
  }

  private static makePart(
    items: any[],
    idx: number,
    encoder: TextEncoder
  ): PartDescriptor {
    const jsonl = items.map(o => JSON.stringify(o)).join('\n') + '\n';

    return {
      name: `part_${String(idx).padStart(6, '0')}.jsonl`,
      mime: 'application/jsonl',
      bytes: encoder.encode(jsonl),
      index: idx,
    };
  }
}
