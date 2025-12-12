import { describe, it, expect } from 'vitest';
import { countTokens, estimateRequestTokens } from '../../src/transform/token-counter.js';

describe('countTokens', () => {
  it('should count tokens for simple text', () => {
    const count = countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('should count tokens for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const count = countTokens(text);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(20);
  });

  it('should handle empty string', () => {
    const count = countTokens('');
    expect(count).toBe(0);
  });

  it('should handle unicode characters', () => {
    const count = countTokens('こんにちは世界');
    expect(count).toBeGreaterThan(0);
  });
});

describe('estimateRequestTokens', () => {
  it('should estimate tokens for message array', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(10);
  });

  it('should handle complex nested objects', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', data: 'abc123' } },
        ],
      },
    ];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(20);
  });
});
