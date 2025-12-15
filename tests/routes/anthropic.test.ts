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

describe('Anthropic Routes', () => {
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

  describe('POST /v1/messages', () => {
    it('should handle non-streaming request', async () => {
      // Mock Anthropic response format (passthrough)
      const mockAnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{type: 'text', text: 'Hello'}],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: {input_tokens: 10, output_tokens: 5},
      };
      vi.mocked(callBackend).mockResolvedValue(mockAnthropicResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: {'x-user-mail': 'test@example.com'},
        payload: {
          model: 'claude-3',
          messages: [{role: 'user', content: 'Hello'}],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      // Verify Anthropic format passthrough
      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Hello');
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
      // Backend is called with Anthropic endpoint
      expect(callBackend).toHaveBeenCalledWith(
        'http://localhost:8000/v1/messages',
        expect.objectContaining({model: 'test-model'}),
        'test-api-key',
      );
    });

    it('should handle streaming request', async () => {
      const chunks = ['data: {"type":"content"}\n\n', 'data: [DONE]\n\n'];
      vi.mocked(streamBackend).mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-3',
          messages: [{role: 'user', content: 'Hello'}],
          max_tokens: 100,
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
        url: '/v1/messages',
        payload: {
          model: 'claude-3',
          messages: [{role: 'user', content: 'Hello'}],
          max_tokens: 100,
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
        url: '/v1/messages',
        payload: {
          model: 'claude-3',
          messages: [{role: 'user', content: 'Hello'}],
          max_tokens: 100,
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

});
