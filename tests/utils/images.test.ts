import {describe, it, expect} from 'vitest';

import {
  hasAnthropicImages,
  hasOpenAIImages,
  getMimeType,
  isImageMimeType,
} from '../../src/utils/images.js';

describe('hasAnthropicImages', () => {
  it('should return true when last message has image blocks', () => {
    const body = {
      model: 'test',
      messages: [
        {role: 'user' as const, content: [{type: 'text', text: 'Hello'}]},
        {role: 'user' as const, content: [{type: 'image', source: {type: 'base64', data: 'abc'}}]},
      ],
      max_tokens: 100,
    };
    expect(hasAnthropicImages(body)).toBe(true);
  });

  it('should return false when no images', () => {
    const body = {
      model: 'test',
      messages: [{role: 'user' as const, content: [{type: 'text', text: 'Hello'}]}],
      max_tokens: 100,
    };
    expect(hasAnthropicImages(body)).toBe(false);
  });

  it('should return false for string content', () => {
    const body = {
      model: 'test',
      messages: [{role: 'user' as const, content: 'Hello'}],
      max_tokens: 100,
    };
    expect(hasAnthropicImages(body)).toBe(false);
  });

  it('should return false for empty messages', () => {
    const body = {model: 'test', messages: [], max_tokens: 100};
    expect(hasAnthropicImages(body)).toBe(false);
  });
});

describe('hasOpenAIImages', () => {
  it('should return true when last message has image_url', () => {
    const body = {
      model: 'test',
      messages: [
        {role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/png;base64,abc'}}]},
      ],
    };
    expect(hasOpenAIImages(body)).toBe(true);
  });

  it('should return false when no images', () => {
    const body = {
      model: 'test',
      messages: [{role: 'user', content: [{type: 'text', text: 'Hello'}]}],
    };
    expect(hasOpenAIImages(body)).toBe(false);
  });

  it('should return false for string content', () => {
    const body = {
      model: 'test',
      messages: [{role: 'user', content: 'Hello'}],
    };
    expect(hasOpenAIImages(body)).toBe(false);
  });
});

describe('getMimeType', () => {
  it('should return mime type for known extensions', () => {
    expect(getMimeType('png')).toBe('image/png');
    expect(getMimeType('jpg')).toBe('image/jpeg');
    expect(getMimeType('json')).toBe('application/json');
  });

  it('should return false for unknown extensions', () => {
    expect(getMimeType('xyz123')).toBe(false);
  });
});

describe('isImageMimeType', () => {
  it('should return true for image types', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('image/jpeg')).toBe(true);
    expect(isImageMimeType('image/webp')).toBe(true);
  });

  it('should return false for non-image types', () => {
    expect(isImageMimeType('application/json')).toBe(false);
    expect(isImageMimeType('text/plain')).toBe(false);
  });
});
