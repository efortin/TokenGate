import { describe, it, expect } from 'vitest';
import { BackendSelector } from '../../src/routing/backend-selector.js';
import type { RouterConfig, AnthropicRequest, OpenAIRequest } from '../../src/types/index.js';

const mockConfig: RouterConfig = {
  port: 3456,
  host: '0.0.0.0',
  apiKey: 'test-key',
  defaultBackend: {
    name: 'default',
    url: 'http://default.local',
    apiKey: 'default-key',
    model: 'default-model',
  },
  visionBackend: {
    name: 'vision',
    url: 'http://vision.local',
    apiKey: 'vision-key',
    model: 'vision-model',
  },
  telemetry: { enabled: false },
  logLevel: 'info',
};

describe('BackendSelector', () => {
  describe('select', () => {
    it('should return default backend for text-only requests', () => {
      const selector = new BackendSelector(mockConfig);
      const request: AnthropicRequest = {
        model: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      const backend = selector.select(request);
      expect(backend.name).toBe('default');
    });

    it('should return vision backend for image requests', () => {
      const selector = new BackendSelector(mockConfig);
      const request: AnthropicRequest = {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            ],
          },
        ],
        max_tokens: 100,
      };

      const backend = selector.select(request);
      expect(backend.name).toBe('vision');
    });

    it('should return default backend when no vision backend configured', () => {
      const configWithoutVision = { ...mockConfig, visionBackend: undefined };
      const selector = new BackendSelector(configWithoutVision);
      const request: AnthropicRequest = {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            ],
          },
        ],
        max_tokens: 100,
      };

      const backend = selector.select(request);
      expect(backend.name).toBe('default');
    });
  });

  describe('selectForOpenAI', () => {
    it('should return default backend for text-only OpenAI requests', () => {
      const selector = new BackendSelector(mockConfig);
      const request: OpenAIRequest = {
        model: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      const backend = selector.selectForOpenAI(request);
      expect(backend.name).toBe('default');
    });

    it('should return vision backend for OpenAI image requests', () => {
      const selector = new BackendSelector(mockConfig);
      const request: OpenAIRequest = {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            ],
          },
        ],
        max_tokens: 100,
      };

      const backend = selector.selectForOpenAI(request);
      expect(backend.name).toBe('vision');
    });

    it('should return default backend when no vision backend configured for OpenAI', () => {
      const configWithoutVision = { ...mockConfig, visionBackend: undefined };
      const selector = new BackendSelector(configWithoutVision);
      const request: OpenAIRequest = {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
            ],
          },
        ],
        max_tokens: 100,
      };

      const backend = selector.selectForOpenAI(request);
      expect(backend.name).toBe('default');
    });
  });

  describe('hasOpenAIVision', () => {
    it('should detect image_url in OpenAI content array', () => {
      const selector = new BackendSelector(mockConfig);
      const request: OpenAIRequest = {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            ],
          },
        ],
        max_tokens: 100,
      };

      expect(selector.hasOpenAIVision(request)).toBe(true);
    });

    it('should return false for text-only OpenAI messages', () => {
      const selector = new BackendSelector(mockConfig);
      const request: OpenAIRequest = {
        model: 'test',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        max_tokens: 100,
      };

      expect(selector.hasOpenAIVision(request)).toBe(false);
    });
  });
});
