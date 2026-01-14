import { useCallback } from 'react';

// Common JSON Value type
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

// Helper to update JSON at a path
export function updateJsonAtPath(json: any, path: string, newValue: JsonValue): any {
  const parts = path.split('/').filter(Boolean);
  // Special case for root update (path is empty)
  if (parts.length === 0) {
    return newValue;
  }
  const result = JSON.parse(JSON.stringify(json));
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = newValue;
  return result;
}

export function useJsonTreeActions({
  json,
  onChange,
}: {
  json: any;
  onChange?: (newJson: any) => void;
}) {
  // Update Value
  const onValueChange = useCallback(
    (path: string, newValue: JsonValue) => {
      if (!onChange) return;
      const updated = updateJsonAtPath(json, path, newValue);
      onChange(updated);
    },
    [json, onChange]
  );

  // Rename Key
  const onKeyRename = useCallback(
    (path: string, newKey: string) => {
      if (!onChange) return;
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) return;
      const oldKey = parts[parts.length - 1];
      
      const result = JSON.parse(JSON.stringify(json));
      let parent = result;
      for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]];
      
      if (Array.isArray(parent) || typeof parent !== 'object') return;
      if (newKey in parent && newKey !== oldKey) return;

      const entries = Object.entries(parent);
      const newEntries: [string, unknown][] = entries.map(([k, v]) =>
        k === oldKey ? [newKey, v] : [k, v]
      );
      
      for (const key of Object.keys(parent)) delete parent[key];
      for (const [k, v] of newEntries) (parent as Record<string, unknown>)[k] = v;
      
      onChange(result);
    },
    [json, onChange]
  );

  // Add Child (Quick Add)
  const onAddChild = useCallback(
    (path: string) => {
      if (!onChange) return;
      // Resolve the parent object based on path
      let targetNode = json;
      if (path) {
        const parts = path.split('/').filter(Boolean);
        for (const part of parts) {
          targetNode = targetNode[part];
        }
      }

      if (targetNode === null || typeof targetNode !== 'object') return;

      if (Array.isArray(targetNode)) {
        // Append to array
        const next = [...targetNode, null];
        onValueChange(path, next);
      } else {
        // Add property to object
        const newKey = `newKey${Object.keys(targetNode).length}`;
        const next = { ...targetNode, [newKey]: null };
        onValueChange(path, next);
      }
    },
    [json, onValueChange, onChange]
  );

  return {
    onValueChange,
    onKeyRename,
    onAddChild,
  };
}

