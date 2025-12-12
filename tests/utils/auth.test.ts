import {describe, it, expect} from 'vitest';

import {isInternalService, getBackendAuth} from '../../src/utils/auth.js';

describe('isInternalService', () => {
  it('should return true for cluster.local URLs', () => {
    expect(isInternalService('http://vllm.default.svc.cluster.local:8000')).toBe(true);
    expect(isInternalService('https://inference.cluster.local/v1')).toBe(true);
  });

  it('should return false for external URLs', () => {
    expect(isInternalService('https://api.example.com')).toBe(false);
    expect(isInternalService('http://localhost:8000')).toBe(false);
  });
});

describe('getBackendAuth', () => {
  it('should use backend apiKey for internal services', () => {
    const backend = {url: 'http://vllm.svc.cluster.local:8000', apiKey: 'internal-key'};
    const result = getBackendAuth(backend, 'client-auth');
    expect(result).toBe('internal-key');
  });

  it('should prefer backend apiKey for external services', () => {
    const backend = {url: 'https://api.example.com', apiKey: 'backend-key'};
    const result = getBackendAuth(backend, 'client-auth');
    expect(result).toBe('backend-key');
  });

  it('should fallback to client auth when no backend key', () => {
    const backend = {url: 'https://api.example.com', apiKey: ''};
    const result = getBackendAuth(backend, 'client-auth');
    expect(result).toBe('client-auth');
  });

  it('should return undefined when no auth available', () => {
    const backend = {url: 'https://api.example.com', apiKey: ''};
    const result = getBackendAuth(backend);
    expect(result).toBeUndefined();
  });
});
