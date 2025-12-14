import {describe, it, expect} from 'vitest';
import {countTokens, estimateRequestTokens} from '../../src/utils/tokens.js';

describe('countTokens', () => {
  it('should count tokens for simple text', () => {
    const count = countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it('should count tokens for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. This is a longer sentence to test token counting.';
    const count = countTokens(text);
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(50);
  });

  it('should handle empty string', () => {
    const count = countTokens('');
    expect(count).toBe(0);
  });

  it('should handle special characters', () => {
    const count = countTokens('Hello! @#$%^&*() 你好');
    expect(count).toBeGreaterThan(0);
  });

  it('should handle JSON strings', () => {
    const json = JSON.stringify({role: 'user', content: 'Hello world'});
    const count = countTokens(json);
    expect(count).toBeGreaterThan(5);
  });

  it('should handle code snippets', () => {
    const code = `function hello() {
  console.log("Hello, world!");
  return 42;
}`;
    const count = countTokens(code);
    expect(count).toBeGreaterThan(10);
  });
});

describe('estimateRequestTokens', () => {
  it('should estimate tokens for simple message array', () => {
    const messages = [{role: 'user', content: 'Hello'}];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(5);
  });

  it('should estimate tokens for multiple messages', () => {
    const messages = [
      {role: 'system', content: 'You are a helpful assistant.'},
      {role: 'user', content: 'Hello'},
      {role: 'assistant', content: 'Hi there! How can I help you today?'},
    ];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(20);
  });

  it('should handle complex message content', () => {
    const messages = [
      {
        role: 'user',
        content: [
          {type: 'text', text: 'What is in this image?'},
          {type: 'image', source: {type: 'base64', data: 'abc123'}},
        ],
      },
    ];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(10);
  });

  it('should handle tool_use messages', () => {
    const messages = [
      {role: 'user', content: 'List files'},
      {
        role: 'assistant',
        content: [{type: 'tool_use', id: 'tool_1', name: 'bash', input: {command: 'ls'}}],
      },
    ];
    const count = estimateRequestTokens(messages);
    expect(count).toBeGreaterThan(20);
  });

  it('should return higher count for larger messages', () => {
    const smallMessages = [{role: 'user', content: 'Hi'}];
    const largeMessages = [
      {role: 'system', content: 'You are a helpful assistant with extensive knowledge.'},
      {role: 'user', content: 'Please write a detailed explanation of how computers work.'},
    ];
    
    const smallCount = estimateRequestTokens(smallMessages);
    const largeCount = estimateRequestTokens(largeMessages);
    
    expect(largeCount).toBeGreaterThan(smallCount);
  });
});
