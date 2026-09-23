export const COMPACT_GUARD_PROTOCOL_VERSION = 'photoshop.guard.compact.v2' as const;
export const UXP_BRIDGE_REVISION = 'compact-v2-20260923-full' as const;
export const RUNTIME_STATE_VERSION = 'photoshop.guard.runtime-state.v2' as const;

export function guardProtocolVersionError(actual: unknown): string {
  return `guard_protocol_version_mismatch: expected ${COMPACT_GUARD_PROTOCOL_VERSION}, received ${String(actual ?? 'missing')}`;
}
