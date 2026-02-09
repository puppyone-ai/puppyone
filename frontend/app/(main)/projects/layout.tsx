import React from 'react';

/**
 * Projects Root Layout
 * 
 * This is a simple passthrough layout.
 * The actual layout with sidebar is in [projectId]/layout.tsx
 */
export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
