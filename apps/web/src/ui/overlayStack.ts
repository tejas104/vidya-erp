/** Module-level stack so stacked overlays (modal-in-modal, menu-over-modal)
 * can tell who is topmost — only the top overlay reacts to Escape. */
const stack: symbol[] = [];

export function pushOverlay(): symbol {
  const id = Symbol("overlay");
  stack.push(id);
  return id;
}
export function popOverlay(id: symbol): void {
  const index = stack.indexOf(id);
  if (index !== -1) stack.splice(index, 1);
}
export function isTopOverlay(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
