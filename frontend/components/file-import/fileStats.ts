import { resolveFormat } from '@/lib/fileFormats';
import type { FileImportStats } from './types';

const TEXT_LIKE_CATEGORIES = new Set(['markdown', 'text', 'code', 'data']);

export function buildFileStats(files: readonly File[]): FileImportStats {
  let textCount = 0;
  let binaryCount = 0;
  const extensions = new Set<string>();

  files.forEach((file) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext) extensions.add(ext);

    const fmt = resolveFormat({ name: file.name, mimeType: file.type || null });
    if (TEXT_LIKE_CATEGORIES.has(fmt.category)) {
      textCount++;
    } else {
      binaryCount++;
    }
  });

  return { textCount, binaryCount, extensions: Array.from(extensions) };
}
