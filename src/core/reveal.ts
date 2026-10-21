// The one way for a slice to ask the shell to show a left view or right tool by id.
// Slices can't import the shell (it imports them), so the shell subscribes here.

const listeners = new Set<(id: string) => void>();

export function reveal(id: string): void {
  listeners.forEach((l) => l(id));
}

export function onReveal(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
