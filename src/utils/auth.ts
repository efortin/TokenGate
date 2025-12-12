import type {BackendConfig} from '../types/index.js';

/** Checks if a URL is an internal cluster service. */
export function isInternalService(url: string): boolean {
  return url.includes('.cluster.local');
}

/**
 * Returns the appropriate auth for a backend.
 * Internal cluster services always use the backend's API key.
 * External services prefer backend key, fallback to client auth.
 */
export function getBackendAuth(
  backend: Pick<BackendConfig, 'url' | 'apiKey'>,
  clientAuth?: string,
): string | undefined {
  if (isInternalService(backend.url)) {
    return backend.apiKey;
  }
  return backend.apiKey || clientAuth;
}
