import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicRouter } from '../src/router.js';
import type { RouterConfig, AnthropicRequest, OpenAIRequest } from '../src/types/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AnthropicRouter', () => {
  const mockConfig: RouterConfig = {
    port: 3456,
    host: '0.0.0.0',
    apiKey: 'test-key',
    defaultBackend: {
      name: 'vllm',
      url: 'http://localhost:8000',
      apiKey: 'backend-key',
      model: 'test-model',
    },
    telemetry: {
      enabled: false,
    },
    logLevel: 'info',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create router with config', () => {
      const router = new AnthropicRouter(mockConfig);
      expect(router).toBeInstanceOf(AnthropicRouter);
    });
  });

  describe('getTelemetryStats', () => {
    it('should return telemetry stats', () => {
      const router = new AnthropicRouter(mockConfig);
      const stats = router.getTelemetryStats();

      expect(stats).toHaveProperty('requestCount');
      expect(stats).toHaveProperty('totalInputTokens');
      expect(stats).toHaveProperty('totalOutputTokens');
      expect(stats).toHaveProperty('totalTokens');
    });
  });

  describe('handleAnthropicRequest', () => {
    it('should proxy request to backend', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'test-model',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const router = new AnthropicRouter(mockConfig);
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      const result = await router.handleAnthropicRequest(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer backend-key',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw on backend error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const router = new AnthropicRouter(mockConfig);
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      await expect(router.handleAnthropicRequest(request)).rejects.toThrow('Backend error: 500');
    });
  });

  describe('handleOpenAIRequest', () => {
    it('should proxy OpenAI request to backend', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const router = new AnthropicRouter(mockConfig);
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = await router.handleOpenAIRequest(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleAnthropicStreamingRequest', () => {
    it('should stream response chunks', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            return { done: false, value: new TextEncoder().encode(chunk) };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const router = new AnthropicRouter(mockConfig);
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of router.handleAnthropicStreamingRequest(request)) {
        results.push(chunk);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });
  });

  describe('handleOpenAIStreamingRequest', () => {
    it('should stream OpenAI response chunks', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            return { done: false, value: new TextEncoder().encode(chunk) };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const router = new AnthropicRouter(mockConfig);
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of router.handleOpenAIStreamingRequest(request)) {
        results.push(chunk);
      }

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
