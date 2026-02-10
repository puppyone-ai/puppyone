import { useState, useEffect } from 'react';

// 定义路径段接口
interface PathSegment {
  id: string;
  type: 'key' | 'num';
  value: string;
}

// 预览数据块接口
interface PreviewChunk {
  key: string;
  value: string;
}

// 钩子函数返回类型
interface DataPathProcessorReturn {
  keyResult: any;
  valueResult: any;
  generatePreviewData: () => void;
}

/**
 * 处理数据源和路径的自定义钩子
 *
 * @param sourceData 源数据数组
 * @param currentSourceIndex 当前数据源索引
 * @param keyPath 键路径段数组
 * @param valuePath 值路径段数组
 * @returns 包含处理结果和功能的对象
 */
export function useDataPathProcessor(
  sourceData: any[],
  currentSourceIndex: number,
  keyPath: PathSegment[],
  valuePath: PathSegment[]
): DataPathProcessorReturn {
  const [keyResult, setKeyResult] = useState<any>(null);
  const [valueResult, setValueResult] = useState<any>(null);
  const [previewData, setPreviewData] = useState<PreviewChunk[]>([
    {
      key: '',
      value: '',
    },
  ]);

  // 从数据源访问指定路径的值
  const getValueByPath = (source: any, path: PathSegment[]): any => {
    if (!source || path.length === 0) return source;

    let result = source;

    try {
      // 遍历路径，深入嵌套对象
      for (const segment of path) {
        if (result && typeof result === 'object') {
          // 根据 segment.type 决定如何访问
          const key =
            segment.type === 'num' && !isNaN(Number(segment.value))
              ? Number(segment.value)
              : segment.value;
          result = result[key];
        } else {
          throw new Error('无法访问路径');
        }
      }
      return result;
    } catch (error) {
      console.error('路径解析错误:', error);
      return 'Path Error';
    }
  };

  // 生成预览数据
  const generatePreviewData = () => {
    // 确保有数据可处理
    if (sourceData.length === 0) {
      return;
    }

    // 获取当前数据源
    const currentSource = sourceData[currentSourceIndex];

    // 获取键路径结果
    const newKeyResult = getValueByPath(currentSource, keyPath);
    setKeyResult(newKeyResult);

    // 获取值路径结果
    const newValueResult = getValueByPath(currentSource, valuePath);
    setValueResult(newValueResult);

    // 显示最后一个段的值作为键
    const lastKeySegment =
      keyPath.length > 0 ? keyPath[keyPath.length - 1].value : '';

    // 构建预览数据
    const pathChunks = [
      {
        key: lastKeySegment,
        value:
          typeof newValueResult === 'object'
            ? JSON.stringify(newValueResult, null, 2)
            : String(newValueResult),
      },
    ];

    setPreviewData(pathChunks);
  };

  // 当依赖项改变时自动更新预览
  useEffect(() => {
    if (sourceData.length > 0) {
      generatePreviewData();
    }
  }, [
    sourceData,
    currentSourceIndex,
    // 我们不直接监听整个数组，而是监听它们的长度和最新值
    keyPath.length,
    keyPath[keyPath.length - 1]?.value,
    valuePath.length,
    valuePath[valuePath.length - 1]?.value,
  ]);

  return {
    keyResult,
    valueResult,
    generatePreviewData,
  };
}
