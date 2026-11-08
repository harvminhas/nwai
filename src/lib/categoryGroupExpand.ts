/**
 * Accounts-tab category expand state.
 *
 * Groups are expanded by default, including categories that appear later
 * (async summary load). Keys present in `userToggles` are explicit user
 * choices and must survive parent rerenders / new sibling groups.
 */
export function isCategoryGroupOpen(
  userToggles: Record<string, boolean>,
  groupType: string
): boolean {
  return userToggles[groupType] ?? true;
}

export function toggleCategoryGroup(
  prev: Record<string, boolean>,
  groupType: string
): Record<string, boolean> {
  return { ...prev, [groupType]: !(prev[groupType] ?? true) };
}
