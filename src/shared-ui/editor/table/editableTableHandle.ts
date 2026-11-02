/** Only pointer retargeting glides. First reveal and layout/scroll corrections
 * land at their current anchor without a forced layout read or another frame. */
export function showEditableTableHandle(
  handle: HTMLElement,
  left: string,
  top: string,
  followPointer = false,
) {
  handle.classList.toggle("is-following-pointer", followPointer && handle.classList.contains("is-visible"));
  handle.style.left = left;
  handle.style.top = top;
  handle.classList.add("is-visible");
}
