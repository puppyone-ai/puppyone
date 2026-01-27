'use client';

import { ContentItem, ContentType, CreateButton } from '../finder/items';

export interface GridViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  thumbnailUrl?: string;
  onClick: (e: React.MouseEvent) => void;
}

export interface GridViewProps {
  items: GridViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  createLabel?: string;
  loading?: boolean;
}

export function GridView({
  items,
  onCreateClick,
  createLabel = 'New...',
  loading,
}: GridViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 16,
      }}
    >
      {items.map(item => (
        <ContentItem
          key={item.id}
          viewType='grid'
          type={item.type}
          id={item.id}
          name={item.name}
          description={item.description}
          rowCount={item.rowCount}
          thumbnailUrl={item.thumbnailUrl}
          onClick={item.onClick}
        />
      ))}

      {onCreateClick && (
        <CreateButton
          viewType='grid'
          label={createLabel}
          onClick={onCreateClick}
        />
      )}
    </div>
  );
}
