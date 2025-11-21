/**
 * VectorIndexing - Direct implementation
 *
 * First implementation following "Rule of Three" principle.
 * Will abstract to strategy pattern in Phase 4 when we have Graph and LLM examples.
 */

export interface PathSegment {
  id: string;
  type: 'key' | 'num';
  value: string;
}

export interface VectorIndexingConfig {
  type: 'vector';
  key_path: PathSegment[];
  value_path: PathSegment[];
}

export interface VectorEntry {
  content: string;
  metadata: {
    id: number;
    retrieval_content: any;
  };
}

export class VectorIndexing {
  /**
   * Extract vector entries from content using indexing config
   *
   * @param content - Source data array
   * @param config - Indexing configuration with key_path and value_path
   * @returns Array of vector entries ready for embedding
   */
  static extractEntries(
    content: any[],
    config: VectorIndexingConfig
  ): VectorEntry[] {
    if (!Array.isArray(content)) {
      throw new Error('Vector indexing requires array content');
    }

    return content.map((item, index) => ({
      content: this.stringifyValue(this.getByPath(item, config.key_path)),
      metadata: {
        id: index,
        retrieval_content: this.getByPath(item, config.value_path),
      },
    }));
  }

  /**
   * Create pending indexing list entry for template instantiation
   *
   * Returns entry with empty entries and pending status.
   * User will trigger indexing to populate entries from content.
   */
  static createPendingEntry(config: VectorIndexingConfig): any {
    return {
      type: 'vector',
      entries: [], // Empty - generated at runtime from content
      status: 'pending', // Awaiting user action
      key_path: config.key_path,
      value_path: config.value_path,
      index_name: '',
      collection_configs: {}, // Empty - populated after embedding
    };
  }

  /**
   * Validate indexing configuration
   */
  static validate(config: VectorIndexingConfig): {
    valid: boolean;
    error?: string;
  } {
    if (!config.key_path || config.key_path.length === 0) {
      return { valid: false, error: 'key_path cannot be empty' };
    }
    return { valid: true };
  }

  /**
   * Extract value from object using path segments
   */
  private static getByPath(obj: any, path: PathSegment[]): any {
    let current = obj;

    for (const seg of path) {
      if (current == null) return undefined;
      current =
        seg.type === 'key' ? current[seg.value] : current[parseInt(seg.value)];
    }

    return current;
  }

  /**
   * Convert value to string for embedding
   */
  private static stringifyValue(val: any): string {
    return val == null
      ? ''
      : typeof val === 'string'
        ? val
        : JSON.stringify(val);
  }
}
