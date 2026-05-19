import type { VersionedNamespaceRoute } from '../types/gateway.types';

/**
 * Type guard that narrows an unknown value to {@link VersionedNamespaceRoute}.
 *
 * Kept in a dedicated value-only module so that callers can import it without
 * triggering @typescript-eslint/no-unsafe-call, which fires when a value
 * function is co-located with type-only exports in the same module under
 * `moduleResolution: nodenext` + `recommendedTypeChecked`.
 */
export function isVersionedNamespaceRoute(
  value: unknown,
): value is VersionedNamespaceRoute {
  return (
    typeof value === 'object' &&
    value !== null &&
    'versions' in value &&
    typeof (value as Record<string, unknown>).versions === 'object' &&
    (value as Record<string, unknown>).versions !== null
  );
}
