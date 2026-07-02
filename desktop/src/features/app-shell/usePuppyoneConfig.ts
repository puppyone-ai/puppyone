import { useCallback, useEffect, useState } from "react";
import type { PuppyoneWorkspaceConfig } from "../../types/electron";
import {
  readPuppyoneWorkspaceConfig,
  writePuppyoneWorkspaceConfig,
} from "../../lib/localFiles";

export function usePuppyoneConfig(workspacePath: string | null) {
  const [puppyoneConfig, setPuppyoneConfig] = useState<PuppyoneWorkspaceConfig | null>(null);
  const [puppyoneConfigLoading, setPuppyoneConfigLoading] = useState(false);
  const [puppyoneConfigSaving, setPuppyoneConfigSaving] = useState(false);
  const [puppyoneConfigError, setPuppyoneConfigError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setPuppyoneConfig(null);
      setPuppyoneConfigError(null);
      setPuppyoneConfigLoading(false);
      return undefined;
    }

    let cancelled = false;
    setPuppyoneConfigLoading(true);
    setPuppyoneConfigError(null);

    readPuppyoneWorkspaceConfig(workspacePath)
      .then((config) => {
        if (cancelled) return;
        setPuppyoneConfig(config);
      })
      .catch((error) => {
        if (cancelled) return;
        setPuppyoneConfig(null);
        setPuppyoneConfigError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPuppyoneConfigLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const handlePuppyoneConfigChange = useCallback(async (nextConfig: PuppyoneWorkspaceConfig) => {
    if (!workspacePath) return null;

    setPuppyoneConfigSaving(true);
    setPuppyoneConfigError(null);
    try {
      const savedConfig = await writePuppyoneWorkspaceConfig(workspacePath, nextConfig);
      setPuppyoneConfig(savedConfig);
      return savedConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPuppyoneConfigError(message);
      throw error;
    } finally {
      setPuppyoneConfigSaving(false);
    }
  }, [workspacePath]);

  return {
    puppyoneConfig,
    puppyoneConfigError,
    puppyoneConfigLoading,
    puppyoneConfigSaving,
    handlePuppyoneConfigChange,
  };
}
