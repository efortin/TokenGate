import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAnthropicRequest, handleAnthropicStreamingRequest } from '../../src/handlers/anthropic.js';
import type { AnthropicRequest, BackendConfig } from '../../src/types/index.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Anthropic Handler', () => {
  const mockBackend: BackendConfig = {
    name: 'vllm',
    url: 'http://localhost:8000',
    apiKey: 'test-key',
    model: 'test-model',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAnthropicRequest', () => {
    it('should send request to backend and return response', async () => {
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

      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      const result = await handleAnthropicRequest(request, { backend: mockBackend });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-key',
            'anthropic-version': '2023-06-01',
          },
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should call onTelemetry with usage data', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      await handleAnthropicRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: 'vllm',
          model: 'test-model',
          inputTokens: 10,
          outputTokens: 5,
          hasToolCalls: false,
          hasVision: false,
        })
      );
    });

    it('should detect tool calls in response', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [
          { type: 'text', text: 'Let me search' },
          { type: 'tool_use', id: 'call_1', name: 'search', input: {} },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Search for X' }],
        max_tokens: 100,
      };

      await handleAnthropicRequest(request, { backend: mockBackend, onTelemetry });

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

      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      await expect(
        handleAnthropicRequest(request, { backend: mockBackend })
      ).rejects.toThrow('Backend error: 500 Internal Server Error');
    });

    it('should handle missing usage data', async () => {
      const mockResponse = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello!' }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const onTelemetry = vi.fn();
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      await handleAnthropicRequest(request, { backend: mockBackend, onTelemetry });

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
        })
      );
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

      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of handleAnthropicStreamingRequest(request, { backend: mockBackend })) {
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

      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      };

      const generator = handleAnthropicStreamingRequest(request, { backend: mockBackend });

      await expect(generator.next()).rejects.toThrow('Backend error: 503');
    });

    it('should throw if no response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      };

      const generator = handleAnthropicStreamingRequest(request, { backend: mockBackend });

      await expect(generator.next()).rejects.toThrow('No response body');
    });

    it('should call onTelemetry after streaming completes', async () => {
      const chunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":15}}}\n\n',
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

      const onTelemetry = vi.fn();
      const request: AnthropicRequest = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      };

      const results: string[] = [];
      for await (const chunk of handleAnthropicStreamingRequest(request, { backend: mockBackend, onTelemetry })) {
        results.push(chunk);
      }

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: 'vllm',
          model: 'test-model',
        })
      );
    });
  });
});
