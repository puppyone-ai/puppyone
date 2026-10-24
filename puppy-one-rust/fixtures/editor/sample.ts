// Code viewer parity sample.
export type Viewer = { id: string; editable: boolean };

export function pick(viewers: readonly Viewer[], id: string): Viewer | null {
  const match = viewers.find((viewer) => viewer.id === id);
  return match ?? null; // fallback stays explicit
}

const count = 42;
console.log(`viewers: ${count}`);
