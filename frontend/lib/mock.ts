export type TableInfo = { id: string; name: string; rows?: number };
export type ProjectInfo = { id: string; name: string; description?: string; tables: TableInfo[] };

export const mockProjects: ProjectInfo[] = [
  {
    id: 'faq-cn',
    name: 'FAQ - CN',
    description: '中文常见问题库',
    tables: [
      { id: 'billing', name: 'billing', rows: 132 },
      { id: 'shipping', name: 'shipping', rows: 98 },
      { id: 'returns', name: 'returns', rows: 45 },
    ],
  },
  {
    id: 'product-docs',
    name: 'Product Docs',
    description: '产品文档（API/Guides）',
    tables: [
      { id: 'apis', name: 'apis', rows: 210 },
      { id: 'guides', name: 'guides', rows: 61 },
    ],
  },
  {
    id: 'support-en',
    name: 'Support - EN',
    description: 'English support knowledge base',
    tables: [
      { id: 'billing', name: 'billing', rows: 120 },
      { id: 'shipping', name: 'shipping', rows: 76 },
      { id: 'policies', name: 'policies', rows: 23 },
    ],
  },
];

export type TableData = {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

const tableColumnMap: Record<string, string[]> = {
  billing: ['user_uuid', 'invoice_id', 'status', 'amount', 'updated_at'],
  shipping: ['user_uuid', 'order_id', 'carrier', 'status', 'eta'],
  returns: ['ticket_id', 'user_uuid', 'reason', 'state', 'created_at'],
  apis: ['endpoint', 'method', 'version', 'owner', 'updated_at'],
  guides: ['guide_id', 'title', 'author', 'tags', 'updated_at'],
  policies: ['policy_id', 'title', 'region', 'effective_at', 'owner'],
};

export function getMockTableData(tableId: string): TableData {
  const columns = tableColumnMap[tableId] ?? ['id', 'value', 'updated_at'];
  const rows = Array.from({ length: 10 }, (_, idx) => {
    const base = idx + 1;
    const record: Record<string, string | number> = {};
    columns.forEach((col, colIdx) => {
      if (col.includes('uuid')) {
        record[col] = `user-${((base * (colIdx + 3)) % 9).toString(16)}${base.toString(16).padStart(4, '0')}`;
      } else if (col.includes('amount')) {
        record[col] = 20 * base + colIdx * 5;
      } else if (col.includes('status')) {
        const statuses = ['pending', 'completed', 'failed', 'in_progress'];
        record[col] = statuses[(base + colIdx) % statuses.length];
      } else if (col.includes('updated_at') || col.includes('created_at') || col.includes('effective_at')) {
        record[col] = `2025-11-${String((base % 9) + 1).padStart(2, '0')} ${String(9 + colIdx).padStart(2, '0')}:${String(
          (base * 7) % 60,
        ).padStart(2, '0')}`;
      } else if (col.includes('endpoint')) {
        record[col] = `/api/v${(base % 5) + 1}/${['users', 'billing', 'shipping'][colIdx % 3]}`;
      } else if (col.includes('method')) {
        record[col] = ['GET', 'POST', 'PATCH', 'DELETE'][(base + colIdx) % 4];
      } else if (col.includes('title')) {
        record[col] = `${col.split('_')[0]} sample ${base}`;
      } else if (col.includes('tags')) {
        record[col] = ['billing', 'shipping', 'faq', 'api'][base % 4];
      } else if (col.includes('carrier')) {
        record[col] = ['UPS', 'FedEx', 'DHL', 'SF'][base % 4];
      } else if (col.includes('owner') || col.includes('author')) {
        record[col] = ['Alex', 'Dana', 'Chris', 'Morgan'][(base + colIdx) % 4];
      } else {
        record[col] = `${col}-${base}`;
      }
    });
    return record;
  });

  return { columns, rows };
}



