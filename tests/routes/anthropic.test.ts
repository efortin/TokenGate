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
      // Mock OpenAI response format (route converts to Anthropic)
      const mockOpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [{
          index: 0,
          message: {role: 'assistant', content: 'Hello'},
          finish_reason: 'stop',
        }],
        usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
      };
      vi.mocked(callBackend).mockResolvedValue(mockOpenAIResponse);

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
      // Verify Anthropic format after conversion
      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Hello');
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
      // Backend is called with OpenAI endpoint
      expect(callBackend).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
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

  describe('Vision routing', () => {
    let visionApp: FastifyInstance;

    const visionConfig: AppConfig = {
      port: 3456,
      host: '0.0.0.0',
      apiKey: 'test-key',
      defaultBackend: {
        name: 'test',
        url: 'http://localhost:8000',
        apiKey: 'test-api-key',
        model: 'test-model',
      },
      visionBackend: {
        name: 'vision',
        url: 'http://localhost:9000',
        apiKey: 'vision-api-key',
        model: 'vision-model',
      },
      logLevel: 'error',
    };

    beforeAll(async () => {
      visionApp = await buildApp({config: visionConfig, logger: false});
    });

    afterAll(async () => {
      await visionApp.close();
    });

    it('should route image requests to vision backend', async () => {
      const mockOpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'vision-model',
        choices: [{
          index: 0,
          message: {role: 'assistant', content: 'I see an image'},
          finish_reason: 'stop',
        }],
        usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120},
      };
      vi.mocked(callBackend).mockResolvedValue(mockOpenAIResponse);

      const response = await visionApp.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-3',
          messages: [{
            role: 'user',
            content: [
              {type: 'text', text: 'What is this?'},
              {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'abc123'}},
            ],
          }],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(callBackend).toHaveBeenCalledWith(
        'http://localhost:9000/v1/chat/completions',
        expect.objectContaining({model: 'vision-model'}),
        'vision-api-key',
      );
    });

    it('should stream vision requests to vision backend', async () => {
      const chunks = ['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n'];
      vi.mocked(streamBackend).mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      });

      const response = await visionApp.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-3',
          messages: [{
            role: 'user',
            content: [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'abc'}}],
          }],
          max_tokens: 100,
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(streamBackend).toHaveBeenCalledWith(
        'http://localhost:9000/v1/chat/completions',
        expect.anything(),
        'vision-api-key',
      );
    });
  });
});
