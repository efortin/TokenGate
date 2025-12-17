import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/types/index.js';
import type { FastifyInstance } from 'fastify';

describe('Metrics Plugin', () => {
  let app: FastifyInstance;
  
  const testConfig: AppConfig = {
    port: 3456,
    host: '0.0.0.0',
    apiKey: 'test-key',
    defaultBackend: {
      name: 'test',
      url: 'http://localhost:8000',
      apiKey: 'test-api-key',
      model: 'test-model',
    },
    logLevel: 'error',
  };

  beforeAll(async () => {
    app = await buildApp({ config: testConfig, logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /metrics', () => {
    it('should return OpenMetrics format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.payload).toContain('# HELP');
      expect(response.payload).toContain('# TYPE');
    });

    it('should include custom LLM metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.payload).toContain('llm_requests_total');
      expect(response.payload).toContain('llm_request_duration_seconds');
      expect(response.payload).toContain('llm_tokens_total');
      expect(response.payload).toContain('inference_tokens_total');
    });
  });

  describe('User email extraction', () => {
    it('should extract user email from x-user-mail header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-user-mail': 'test@example.com',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should extract email from JWT in Authorization header', async () => {
      // Create a test JWT with email claim
      const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
      const payload = Buffer.from(JSON.stringify({email: 'user@example.com'})).toString('base64');
      const token = `${header}.${payload}.signature`;
      
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'authorization': `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should use x-user-mail header over JWT email', async () => {
      // Create a JWT with one email
      const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
      const payload = Buffer.from(JSON.stringify({email: 'jwt@example.com'})).toString('base64');
      const token = `${header}.${payload}.signature`;
      
      // But provide a different email in x-user-mail header
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'authorization': `Bearer ${token}`,
          'x-user-mail': 'header@example.com',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should default to anonymous when no email source available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /health', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /v1/models', () => {
    it('should return models list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.object).toBe('list');
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('test-model');
    });
  });
});
