import {describe, it, expect} from 'vitest';

import {isInternalService, getBackendAuth, decodeJWT, extractEmailFromAuth, hashEmail} from '../../src/utils/auth.js';

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

describe('decodeJWT', () => {
  it('should decode a valid JWT and return claims', () => {
    // Create a test JWT with known payload
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      email: 'test@example.com',
      aud: 'test-audience',
      exp: 1768027836,
    })).toString('base64');
    const signature = 'signature';
    const token = `${header}.${payload}.${signature}`;

    const result = decodeJWT(token);
    expect(result).toEqual({
      email: 'test@example.com',
      aud: 'test-audience',
      exp: 1768027836,
    });
  });

  it('should return null for invalid JWT format', () => {
    expect(decodeJWT('not.a.valid.token')).toBeNull();
    expect(decodeJWT('header.payload')).toBeNull();
    expect(decodeJWT('header.payload.signature.extra')).toBeNull();
  });

  it('should return null for malformed base64', () => {
    const invalidToken = 'invalid.base64.signature';
    expect(decodeJWT(invalidToken)).toBeNull();
  });

  it('should return null for invalid JSON in payload', () => {
    const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
    const invalidPayload = Buffer.from('{invalid json').toString('base64');
    const token = `${header}.${invalidPayload}.signature`;
    expect(decodeJWT(token)).toBeNull();
  });
});

describe('extractEmailFromAuth', () => {
  it('should extract email from valid JWT in Authorization header', () => {
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      email: 'user@example.com',
      aud: 'QDFtFvSFIWQLopuBZnVqkm4mhM',
      exp: 1768027836,
      iss: 'https://identity-provider.com/v1/identity/oidc',
    })).toString('base64');
    const signature = 'signature';
    const token = `${header}.${payload}.${signature}`;
    const authHeader = `Bearer ${token}`;

    const result = extractEmailFromAuth(authHeader);
    expect(result).toBe('user@example.com');
  });

  it('should return null when Authorization header is missing', () => {
    expect(extractEmailFromAuth(undefined)).toBeNull();
    expect(extractEmailFromAuth('')).toBeNull();
  });

  it('should return null when token is not in Bearer format', () => {
    const invalidToken = 'notabearertoken';
    expect(extractEmailFromAuth(invalidToken)).toBeNull();
  });

  it('should return null when JWT is invalid', () => {
    const authHeader = 'Bearer invalid.token';
    expect(extractEmailFromAuth(authHeader)).toBeNull();
  });

  it('should return null when JWT has no email claim', () => {
    const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({sub: 'user-123', name: 'Test User'})).toString('base64');
    const token = `${header}.${payload}.signature`;
    const authHeader = `Bearer ${token}`;

    expect(extractEmailFromAuth(authHeader)).toBeNull();
  });

  it('should handle email claim with different types', () => {
    const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({email: 12345})).toString('base64');
    const token = `${header}.${payload}.signature`;
    const authHeader = `Bearer ${token}`;

    // Non-string email should return null
    expect(extractEmailFromAuth(authHeader)).toBeNull();
  });
});

describe('hashEmail', () => {
  it('should create consistent hash for same email', () => {
    const email = 'user@example.com';
    const hash1 = hashEmail(email);
    const hash2 = hashEmail(email);
    expect(hash1).toBe(hash2);
  });

  it('should create different hashes for different emails', () => {
    const hash1 = hashEmail('user@example.com');
    const hash2 = hashEmail('john.doe@example.com');
    expect(hash1).not.toBe(hash2);
  });

  it('should be case-insensitive', () => {
    const hash1 = hashEmail('User@Example.com');
    const hash2 = hashEmail('user@example.com');
    expect(hash1).toBe(hash2);
  });

  it('should return an 8-character hex string', () => {
    const email = 'test@example.com';
    const hash = hashEmail(email);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it('should handle edge cases', () => {
    const emptyHash = hashEmail('');
    expect(emptyHash).toBe('00000000'); // hash of empty string is 0, padded to 8 chars
    
    const simpleHash = hashEmail('a');
    expect(simpleHash).toMatch(/^[a-f0-9]{8}$/);
  });
});
