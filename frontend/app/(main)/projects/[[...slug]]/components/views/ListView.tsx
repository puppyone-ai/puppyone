'use client';

import { ContentItem, ContentType, CreateButton } from '../finder/items';

export interface ListViewItem {
  id: string;
  name: string;
  type: ContentType;
  description?: string;
  rowCount?: number;
  onClick: (e: React.MouseEvent) => void;
}

export interface ListViewProps {
  items: ListViewItem[];
  onCreateClick?: (e: React.MouseEvent) => void;
  createLabel?: string;
  loading?: boolean;
}

export function ListView({
  items,
  onCreateClick,
  createLabel = 'New...',
  loading,
}: ListViewProps) {
  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map(item => (
        <ContentItem
          key={item.id}
          viewType='list'
          type={item.type}
          id={item.id}
          name={item.name}
          description={item.description}
          rowCount={item.rowCount}
          onClick={item.onClick}
        />
      ))}

      {onCreateClick && (
        <CreateButton
          viewType='list'
          label={createLabel}
          onClick={onCreateClick}
        />
      )}
    </div>
  );
}
