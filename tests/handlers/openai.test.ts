import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOpenAIRequest, handleOpenAIStreamingRequest } from '../../src/handlers/openai.js';
import type { OpenAIRequest, BackendConfig } from '../../src/types/index.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenAI Handler', () => {
  const mockBackend: BackendConfig = {
    name: 'vllm',
    url: 'http://localhost:8000',
    apiKey: 'test-key',
    model: 'test-model',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleOpenAIRequest', () => {
    it('should send request to backend and return response', async () => {
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

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = await handleOpenAIRequest(request, { backend: mockBackend });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
          },
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should call onTelemetry with usage data', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [{
          message: { role: 'assistant', content: 'Hello!' },
        }],
        usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await handleOpenAIRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: 'vllm',
          model: 'test-model',
          inputTokens: 15,
          outputTokens: 8,
          hasToolCalls: false,
          hasVision: false,
        })
      );
    });

    it('should detect tool calls in response', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Search for X' }],
      };

      await handleOpenAIRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          hasToolCalls: true,
        })
      );
    });

    it('should throw on backend error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await expect(
        handleOpenAIRequest(request, { backend: mockBackend })
      ).rejects.toThrow('Backend error: 500 Internal Server Error');
    });

    it('should handle missing usage data', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [{
          message: { role: 'assistant', content: 'Hello!' },
        }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await handleOpenAIRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
        })
      );
    });

    it('should handle empty choices array', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await handleOpenAIRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          hasToolCalls: false,
        })
      );
    });
  });

  describe('handleOpenAIStreamingRequest', () => {
    it('should stream response chunks', async () => {
      const chunks = [
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"}}]}\n\n',
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

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of handleOpenAIStreamingRequest(request, { backend: mockBackend })) {
        results.push(chunk);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(mockReader.releaseLock).toHaveBeenCalled();
    });

    it('should throw on backend error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const generator = handleOpenAIStreamingRequest(request, { backend: mockBackend });

      await expect(generator.next()).rejects.toThrow('Backend error: 503');
    });

    it('should throw if no response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const generator = handleOpenAIStreamingRequest(request, { backend: mockBackend });

      await expect(generator.next()).rejects.toThrow('No response body');
    });

    it('should track usage from streaming events', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hi"}}],"usage":{"prompt_tokens":10}}\n\n',
        'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"completion_tokens":5}}\n\n',
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

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const stream = handleOpenAIStreamingRequest(request, { backend: mockBackend, onTelemetry });
      while (!(await stream.next()).done) { /* consume */ }

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 10,
          outputTokens: 5,
        })
      );
    });

    it('should detect tool calls in streaming response', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"search"}}]}}]}\n\n',
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

      const onTelemetry = vi.fn();
      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Search' }],
        stream: true,
      };

      const stream = handleOpenAIStreamingRequest(request, { backend: mockBackend, onTelemetry });
      while (!(await stream.next()).done) { /* consume */ }

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          hasToolCalls: true,
        })
      );
    });

    it('should handle malformed JSON in stream gracefully', async () => {
      const chunks = [
        'data: {invalid json}\n\n',
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
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

      const request: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of handleOpenAIStreamingRequest(request, { backend: mockBackend })) {
        results.push(chunk);
      }

      // Should not throw, just skip malformed JSON
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
