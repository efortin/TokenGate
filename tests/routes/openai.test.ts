import {describe, it, expect, beforeAll, afterAll, vi, beforeEach} from 'vitest';
import {buildApp} from '../../src/app.js';
import type {AppConfig} from '../../src/types/index.js';
import type {FastifyInstance} from 'fastify';

vi.mock('../../src/services/backend.js', () => ({
  callBackend: vi.fn(),
  streamBackend: vi.fn(),
  discoverModels: vi.fn().mockResolvedValue([]),
  checkHealth: vi.fn().mockResolvedValue(true),
}));

import {callBackend, streamBackend} from '../../src/services/backend.js';

describe('OpenAI Routes', () => {
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
    app = await buildApp({config: testConfig, logger: false});
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /v1/chat/completions', () => {
    it('should handle non-streaming request', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [{index: 0, message: {role: 'assistant', content: 'Hello'}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
      };
      vi.mocked(callBackend).mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {'x-user-mail': 'test@example.com'},
        payload: {
          model: 'gpt-4',
          messages: [{role: 'user', content: 'Hello'}],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockResponse);
      expect(callBackend).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
        expect.objectContaining({model: 'test-model'}),
        'test-api-key',
      );
    });

    it('should handle streaming request', async () => {
      const chunks = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n'];
      vi.mocked(streamBackend).mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4',
          messages: [{role: 'user', content: 'Hello'}],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(streamBackend).toHaveBeenCalled();
    });

    it('should handle backend error', async () => {
      vi.mocked(callBackend).mockRejectedValue(new Error('Backend unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4',
          messages: [{role: 'user', content: 'Hello'}],
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.type).toBe('api_error');
    });

    it('should handle streaming error', async () => {
      vi.mocked(streamBackend).mockImplementation(async function* () {
        yield 'data: start\n\n';
        throw new Error('Stream error');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4',
          messages: [{role: 'user', content: 'Hello'}],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
