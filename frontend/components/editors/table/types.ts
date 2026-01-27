import { McpToolPermissions } from '../../../../lib/mcpApi';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface FlatNode {
  path: string;
  key: string | number;
  value: JsonValue;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  isExpandable: boolean;
  parentLines: boolean[];
}

export interface ConfiguredAccessPoint {
  path: string;
  permissions: McpToolPermissions;
}

