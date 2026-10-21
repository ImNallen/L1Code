import { createStore } from "@/core/store";

/** Whether the quick-open overlay is showing. */
export const quickOpenVisible = createStore(false);

export function toggleQuickOpen(): void {
  quickOpenVisible.update((v) => !v);
}
