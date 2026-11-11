import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from '@st/db';

export { PERMISSIONS, SYSTEM_ROLES };
export type { PermissionKey, SystemRoleKey };

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** Pure check used by services and UI gating. The database enforces the same rules via RLS. */
export function hasPermission(granted: readonly string[], required: PermissionKey): boolean {
  return granted.includes(required);
}

export function permissionsForSystemRole(role: SystemRoleKey): readonly PermissionKey[] {
  return SYSTEM_ROLES[role].permissions;
}
