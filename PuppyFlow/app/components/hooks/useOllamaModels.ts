import { useState, useEffect, useCallback } from 'react';
import { Model } from '../states/AppSettingsContext';

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaResponse {
  models: OllamaModel[];
}

interface UseOllamaModelsOptions {
  endpoint?: string;
  autoFetch?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

interface UseOllamaModelsReturn {
  models: Model[];
  rawModels: OllamaModel[];
  loading: boolean;
  error: string | null;
  isConnected: boolean;
  fetchModels: () => Promise<void>;
  refetch: () => Promise<void>;
  checkConnection: () => Promise<boolean>;
}

// 格式化模型名称，让显示更友好
function formatModelName(modelId: string): string {
  // 移除版本标签，首字母大写
  const baseName = modelId.split(':')[0];
  return baseName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// 判断模型类型的函数
function detectModelType(modelName: string): 'llm' | 'embedding' {
  const lowerName = modelName.toLowerCase();

  // 常见的 embedding 模型关键词
  const embeddingKeywords = [
    'embed',
    'embedding',
    'bge',
    'e5',
    'sentence',
    'text-embedding',
    'nomic-embed',
    'mxbai-embed',
    'snowflake-arctic-embed',
  ];

  // 检查模型名称是否包含 embedding 相关关键词
  const isEmbedding = embeddingKeywords.some(keyword =>
    lowerName.includes(keyword)
  );

  return isEmbedding ? 'embedding' : 'llm';
}

// 将 Ollama 原始模型转换为应用的 Model 格式
function transformOllamaModel(ollamaModel: OllamaModel): Model {
  return {
    id: ollamaModel.name,
    name: formatModelName(ollamaModel.name),
    provider: 'ollama',
    isLocal: true,
    active: true,
    type: detectModelType(ollamaModel.name), // 新增：自动检测模型类型
  };
}

export function useOllamaModels(
  options: UseOllamaModelsOptions = {}
): UseOllamaModelsReturn {
  const {
    endpoint = process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT ||
      'http://localhost:11434',
    autoFetch = true,
    retryAttempts = 3,
    retryDelay = 1000,
  } = options;

  const [models, setModels] = useState<Model[]>([]);
  const [rawModels, setRawModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // 检查 Ollama 服务连接
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      const connected = response.ok;
      setIsConnected(connected);
      return connected;
    } catch (error) {
      setIsConnected(false);
      return false;
    }
  }, [endpoint]);

  // 获取模型列表（带重试机制）
  const fetchModels = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        const response = await fetch(`${endpoint}/api/tags`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: OllamaResponse = await response.json();

        // 打印 Ollama 原生 SDK 返回的完整数据
        console.log('🐕 Ollama Raw Response:', JSON.stringify(data, null, 2));

        const ollamaModels = data.models || [];
        const transformedModels = ollamaModels.map(transformOllamaModel);

        setRawModels(ollamaModels);
        setModels(transformedModels);
        setIsConnected(true);
        setError(null);
        return;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误';
        console.warn(
          `Ollama 连接尝试 ${attempt}/${retryAttempts} 失败:`,
          errorMessage
        );

        if (attempt === retryAttempts) {
          setError(`经过 ${retryAttempts} 次尝试后仍然失败: ${errorMessage}`);
          setIsConnected(false);
          setModels([]);
          setRawModels([]);
        } else {
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
  }, [endpoint, retryAttempts, retryDelay]);

  // 重新获取（别名，为了 API 一致性）
  const refetch = useCallback(() => fetchModels(), [fetchModels]);

  // 自动获取模型列表
  useEffect(() => {
    if (autoFetch) {
      fetchModels();
    }
  }, [autoFetch, fetchModels]);

  // 定期检查连接状态（可选）
  useEffect(() => {
    if (!autoFetch) return;

    const interval = setInterval(() => {
      if (!loading) {
        checkConnection();
      }
    }, 30000); // 每30秒检查一次

    return () => clearInterval(interval);
  }, [autoFetch, loading, checkConnection]);

  return {
    models,
    rawModels,
    loading,
    error,
    isConnected,
    fetchModels,
    refetch,
    checkConnection,
  };
}

// 导出一些有用的工具函数
export { formatModelName, transformOllamaModel };
export type { OllamaModel, OllamaResponse, UseOllamaModelsOptions };
