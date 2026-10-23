import type {
  VersionedNamespaceRoute,
  PublicPathRule,
} from '../types/gateway.types';
import { isRecord } from './validation.utils';

export function isPublicPathRule(value: unknown): value is PublicPathRule {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.trim().length > 0 &&
    (value.methods === undefined ||
      (Array.isArray(value.methods) &&
        value.methods.length > 0 &&
        value.methods.every(
          (method) => typeof method === 'string' && method.trim().length > 0,
        )))
  );
}

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
    isRecord(value) &&
    isRecord(value.versions) &&
    Object.values(value.versions).every(
      (target) => typeof target === 'string',
    ) &&
    (value.public === undefined || typeof value.public === 'boolean') &&
    (value.publicPaths === undefined ||
      (Array.isArray(value.publicPaths) &&
        value.publicPaths.every(isPublicPathRule)))
  );
}
