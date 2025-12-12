import {describe, it, expect} from 'vitest';

import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
} from '../../src/utils/http.js';

describe('SSE_HEADERS', () => {
  it('should have correct content type', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream');
  });

  it('should disable caching', () => {
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache');
  });

  it('should keep connection alive', () => {
    expect(SSE_HEADERS['Connection']).toBe('keep-alive');
  });
});

describe('StatusCodes', () => {
  it('should export common status codes', () => {
    expect(StatusCodes.OK).toBe(200);
    expect(StatusCodes.BAD_REQUEST).toBe(400);
    expect(StatusCodes.INTERNAL_SERVER_ERROR).toBe(500);
  });
});

describe('createApiError', () => {
  it('should create error object with default type', () => {
    const error = createApiError('Something went wrong');
    expect(error).toEqual({
      error: {
        type: 'api_error',
        message: 'Something went wrong',
      },
    });
  });

  it('should create error object with custom type', () => {
    const error = createApiError('Invalid request', 'invalid_request_error');
    expect(error).toEqual({
      error: {
        type: 'invalid_request_error',
        message: 'Invalid request',
      },
    });
  });
});

describe('formatSseError', () => {
  it('should format Error instance', () => {
    const result = formatSseError(new Error('Test error'));
    expect(result).toContain('data:');
    expect(result).toContain('Test error');
    expect(result).toContain('api_error');
    expect(result.endsWith('\n\n')).toBe(true);
  });

  it('should handle non-Error objects', () => {
    const result = formatSseError('string error');
    expect(result).toContain('Unknown error');
  });

  it('should include error type in response', () => {
    const result = formatSseError(new Error('Test'));
    const parsed = JSON.parse(result.replace('data: ', '').trim());
    expect(parsed.type).toBe('error');
    expect(parsed.error.type).toBe('api_error');
  });
});
