/**
 * Connect API Client
 * For communicating with backend Connect API
 */

import { getApiAccessToken } from './apiClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

export interface ParseUrlRequest {
  url: string;
}

export interface DataField {
  name: string;
  type: string;
  sample_value?: any;
}

export interface ParseUrlResponse {
  url: string;
  source_type: string;
  title?: string;
  fields: DataField[];
  sample_data: Record<string, any>[];
  total_items: number;
  data_structure: string;
}

export interface ImportDataRequest {
  url: string;
  project_id: number;
  table_id?: number;
  table_name?: string;
  table_description?: string;
  target_path?: string; // Legacy
  import_mode?: 'add_to_existing' | 'replace_all' | 'keep_separate';
  merge_strategy?: 'replace' | 'merge_object' | 'append_array' | 'smart'; // Legacy
}

export interface ImportDataResponse {
  success: boolean;
  project_id: number;
  table_id: number;
  table_name: string;
  items_imported: number;
  message: string;
}

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

/**
 * Parse URL and return data preview
 */
export async function parseUrl(url: string): Promise<ParseUrlResponse> {
  const token = await getApiAccessToken();

  const response = await fetch(`${API_BASE_URL}/api/v1/connect/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Failed to parse URL' }));
    throw new Error(
      error.message || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const result: ApiResponse<ParseUrlResponse> = await response.json();

  if (result.code !== 0) {
    throw new Error(result.message || 'Failed to parse URL');
  }

  return result.data;
}

/**
 * Import data to project table
 */
export async function importData(
  params: ImportDataRequest
): Promise<ImportDataResponse> {
  const token = await getApiAccessToken();

  const response = await fetch(`${API_BASE_URL}/api/v1/connect/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Failed to import data' }));
    throw new Error(
      error.message || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const result: ApiResponse<ImportDataResponse> = await response.json();

  if (result.code !== 0) {
    throw new Error(result.message || 'Failed to import data');
  }

  return result.data;
}
