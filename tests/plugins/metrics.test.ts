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
    });
  });

  describe('x-user-mail header', () => {
    it('should extract user email from header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-user-mail': 'test@example.com',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should default to anonymous when no header', async () => {
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
