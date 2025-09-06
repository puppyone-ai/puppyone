// Shared ManifestPoller for external storage structured/text content
// Centralizes polling and reconstruction of chunked content.

export type ContentType = 'text' | 'structured';

export interface PollerContext {
  setNodes: (updater: (nodes: any[]) => any[]) => void;
  resetLoadingUI?: (nodeId: string) => void;
}

interface ManifestChunk {
  name: string;
  size: number;
  index: number;
  state?: 'processing' | 'done';
}

interface Manifest {
  chunks: ManifestChunk[];
  content_type: string;
  total_size: number;
}

class ManifestPoller {
  private poller: NodeJS.Timeout | null = null;
  private knownChunks = new Set<string>();
  private context: PollerContext;
  private resource_key: string;
  private block_id: string;
  private content_type: ContentType;
  private chunks: string[] = [];
  private isStopped = false;
  // Structured JSONL incremental parsing state
  private parsedRecords: any[] = [];
  private leftoverPartialLine = '';
  private totalRecords = 0;
  private parseErrors = 0;

  constructor(
    context: PollerContext,
    resource_key: string,
    block_id: string,
    content_type: ContentType = 'text'
  ) {
    this.context = context;
    this.resource_key = resource_key;
    this.block_id = block_id;
    this.content_type = content_type;
  }

  start() {
    this.context.setNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === this.block_id
          ? {
              ...node,
              data: {
                ...node.data,
                content: '',
                isLoading: true,
                isExternalStorage: true,
                external_metadata: {
                  ...(node.data?.external_metadata || {}),
                  resource_key: this.resource_key,
                  content_type: this.content_type,
                },
              },
            }
          : node
      )
    );
    this.poll();
  }

  private poll() {
    if (this.isStopped) return;
    this.poller = setTimeout(async () => {
      await this.fetchManifestAndChunks();
      if (!this.isStopped) this.poll();
    }, 1000);
  }

  async stop() {
    this.isStopped = true;
    if (this.poller) {
      clearTimeout(this.poller);
      this.poller = null;
    }
    await this.fetchManifestAndChunks();
    if (this.content_type === 'structured') {
      this.finalizeStructuredParsing();
      const finalContent = this.reconstructContent({
        chunks: [],
        content_type: this.content_type,
        total_size: 0,
      });
      this.context.setNodes(prevNodes =>
        prevNodes.map(node =>
          node.id === this.block_id
            ? {
                ...node,
                data: {
                  ...node.data,
                  content: finalContent,
                  isLoading: false,
                  isExternalStorage: true,
                  external_metadata: {
                    ...(node.data?.external_metadata || {}),
                    resource_key: this.resource_key,
                    content_type: this.content_type,
                    loadedChunks: this.chunks.length,
                    totalRecords: this.totalRecords,
                    parsedRecords: this.parsedRecords.length,
                    parseErrors: this.parseErrors,
                  },
                },
              }
            : node
        )
      );
    }
    if (this.context.resetLoadingUI) this.context.resetLoadingUI(this.block_id);
  }

  private async fetchManifestAndChunks() {
    try {
      const manifestUrl = await this.getDownloadUrl(
        `${this.resource_key}/manifest.json`
      );
      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) return;
      const manifest: Manifest = await manifestResponse.json();

      const newChunks = manifest.chunks
        .filter(c => !this.knownChunks.has(c.name) && c.state === 'done')
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (newChunks.length === 0) return;

      for (const chunkInfo of newChunks) {
        this.knownChunks.add(chunkInfo.name);
        const chunkUrl = await this.getDownloadUrl(
          `${this.resource_key}/${chunkInfo.name}`
        );
        const chunkResponse = await fetch(chunkUrl);
        const chunkData = await chunkResponse.text();
        this.chunks.push(chunkData);
        if (this.content_type === 'structured') {
          this.parseStructuredChunk(chunkData, chunkInfo.name);
        }
      }

      const reconstructedContent = this.reconstructContent(manifest);
      this.context.setNodes(prevNodes =>
        prevNodes.map(node =>
          node.id === this.block_id
            ? {
                ...node,
                data: {
                  ...node.data,
                  content: reconstructedContent,
                  isLoading: true,
                  isExternalStorage: true,
                  external_metadata: {
                    ...(node.data?.external_metadata || {}),
                    resource_key: this.resource_key,
                    content_type: this.content_type,
                    totalChunks: manifest.chunks.length,
                    loadedChunks: this.chunks.length,
                    totalRecords: this.totalRecords,
                    parsedRecords: this.parsedRecords.length,
                    parseErrors: this.parseErrors,
                  },
                },
              }
            : node
        )
      );
    } catch (err) {
      console.error('[ManifestPoller] Error fetching manifest/chunk:', err);
    }
  }

  private reconstructContent(manifest: Manifest): string {
    if (this.content_type === 'structured') {
      try {
        return JSON.stringify(this.parsedRecords, null, 2);
      } catch (e) {
        console.warn('[ManifestPoller] Failed stringify records:', e);
        return '[]';
      }
    }
    return this.chunks.join('');
  }

  private parseStructuredChunk(chunkText: string, chunkName: string) {
    let dataToProcess = (this.leftoverPartialLine || '') + chunkText;
    this.leftoverPartialLine = '';
    const lines = dataToProcess.split(/\r?\n/);
    const possibleLeftover = lines.pop() ?? '';

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) continue;
      this.totalRecords += 1;
      try {
        const parsed = JSON.parse(line);
        this.parsedRecords.push(parsed);
      } catch (err) {
        this.parseErrors += 1;
        console.warn(
          `[ManifestPoller] JSONL parse error in ${chunkName} at record #${this.totalRecords}:`,
          err
        );
        console.warn('[ManifestPoller] Offending line:', rawLine.slice(0, 500));
      }
    }

    this.leftoverPartialLine = possibleLeftover;
  }

  private finalizeStructuredParsing(): void {
    // Flush any leftover partial line(s) into parsed records
    const tail = this.leftoverPartialLine;
    this.leftoverPartialLine = '';
    if (!tail) return;
    const lines = tail.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) continue;
      this.totalRecords += 1;
      try {
        const parsed = JSON.parse(line);
        this.parsedRecords.push(parsed);
      } catch (err) {
        this.parseErrors += 1;
        console.warn('[ManifestPoller] JSONL final parse error at record #' + this.totalRecords + ':', err);
        console.warn('[ManifestPoller] Offending tail line:', rawLine.slice(0, 500));
      }
    }
  }

  private async getDownloadUrl(key: string): Promise<string> {
    const response = await fetch(
      `/api/storage/download/url?key=${encodeURIComponent(key)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get download URL for ${key}`);
    }
    const data = await response.json();
    return data.download_url;
  }
}

const pollers = new Map<string, ManifestPoller>();
const makeKey = (resourceKey: string, blockId: string) => `${resourceKey}_${blockId}`;

export function ensurePollerStarted(
  context: PollerContext,
  resourceKey: string,
  blockId: string,
  contentType: ContentType = 'text'
) {
  const key = makeKey(resourceKey, blockId);
  if (pollers.has(key)) return;
  const poller = new ManifestPoller(context, resourceKey, blockId, contentType);
  pollers.set(key, poller);
  poller.start();
}

export async function ensurePollerStoppedAndFinalize(
  context: PollerContext,
  resourceKey: string,
  blockId: string,
  contentType: ContentType = 'text'
) {
  const key = makeKey(resourceKey, blockId);
  if (!pollers.has(key)) {
    // one-shot fetch/finalize
    const poller = new ManifestPoller(context, resourceKey, blockId, contentType);
    pollers.set(key, poller);
    await poller.stop();
    pollers.delete(key);
    return;
  }
  const poller = pollers.get(key)!;
  await poller.stop();
  pollers.delete(key);
}
