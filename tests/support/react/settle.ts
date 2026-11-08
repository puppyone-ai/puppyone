import { act } from "react";

/**
 * Lets every answer a fake bridge has already given reach React: one macrotask,
 * inside act. For the moments nothing on screen marks as done; where something
 * does, wait for it with vi.waitFor instead.
 */
export async function settleBridge() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
