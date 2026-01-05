/**
 * 将 tree path 转换为 JSON Pointer 格式 (RFC 6901)
 *
 * JSON Pointer 格式说明：
 * - 路径段之间用 '/' 分隔
 * - 特殊字符需要转义：'~' -> '~0', '/' -> '~1'
 * - 空路径表示根路径，返回空字符串 ""
 *
 * @param treePath - tree path 字符串，例如 "/users/0/name" 或 "/users/0"
 * @returns JSON Pointer 格式的字符串，例如 "/users/0/name" 或 ""
 */
export function treePathToJsonPointer(
  treePath: string | null | undefined
): string {
  // 如果路径为空、null 或 undefined，返回空字符串（表示根路径）
  if (!treePath || treePath.trim() === '') {
    return '';
  }

  // 移除开头的 '/'（如果有）
  let path = treePath.trim();
  if (path.startsWith('/')) {
    path = path.substring(1);
  }

  // 如果移除后为空，返回空字符串（根路径）
  if (path === '') {
    return '';
  }

  // 分割路径段
  const segments = path.split('/');

  // 转义每个路径段中的特殊字符
  const escapedSegments = segments.map(segment => {
    // 转义：'~' -> '~0', '/' -> '~1'
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
  });

  // 重新组合为 JSON Pointer 格式
  return '/' + escapedSegments.join('/');
}
