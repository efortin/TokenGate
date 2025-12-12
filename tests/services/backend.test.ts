import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

import {
  callBackend,
  streamBackend,
  discoverModels,
  checkHealth,
} from '../../src/services/backend.js';

describe('callBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should call backend and return JSON response', async () => {
    const mockData = {id: 'test', content: 'response'};
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve(mockData),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await callBackend<typeof mockData>(
      'http://localhost:8000/v1/messages',
      {model: 'test'},
      'api-key',
    );

    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer api-key',
        }),
      }),
    );
  });

  it('should handle Bearer prefix in auth', async () => {
    const mockResponse = {ok: true, json: () => Promise.resolve({})};
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    await callBackend('http://localhost:8000', {}, 'Bearer existing-token');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer existing-token',
        }),
      }),
    );
  });

  it('should throw on non-ok response', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal error'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    await expect(
      callBackend('http://localhost:8000', {}),
    ).rejects.toThrow('Backend error: 500');
  });
});

describe('streamBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should stream response chunks', async () => {
    const chunks = [
      new TextEncoder().encode('data: chunk1\n\n'),
      new TextEncoder().encode('data: chunk2\n\n'),
    ];
    let chunkIndex = 0;

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < chunks.length) {
          return Promise.resolve({done: false, value: chunks[chunkIndex++]});
        }
        return Promise.resolve({done: true, value: undefined});
      }),
      releaseLock: vi.fn(),
    };

    const mockResponse = {
      ok: true,
      body: {getReader: () => mockReader},
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const results: string[] = [];
    for await (const chunk of streamBackend('http://localhost:8000', {})) {
      results.push(chunk);
    }

    expect(results).toHaveLength(2);
    expect(mockReader.releaseLock).toHaveBeenCalled();
  });

  it('should throw on non-ok response', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve('Error'),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const generator = streamBackend('http://localhost:8000', {});
    await expect(generator.next()).rejects.toThrow('Backend error: 500');
  });

  it('should throw if no response body', async () => {
    const mockResponse = {ok: true, body: null};
    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const generator = streamBackend('http://localhost:8000', {});
    await expect(generator.next()).rejects.toThrow('No response body');
  });
});

describe('discoverModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return model ids from API response', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({data: [{id: 'model-1'}, {id: 'model-2'}]}),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const models = await discoverModels('http://localhost:8000', 'api-key');

    expect(models).toEqual(['model-1', 'model-2']);
  });

  it('should return empty array on error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const models = await discoverModels('http://localhost:8000');

    expect(models).toEqual([]);
  });

  it('should return empty array on non-ok response', async () => {
    const mockResponse = {ok: false};
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const models = await discoverModels('http://localhost:8000');

    expect(models).toEqual([]);
  });
});

describe('checkHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return true on ok response', async () => {
    const mockResponse = {ok: true};
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const healthy = await checkHealth('http://localhost:8000');

    expect(healthy).toBe(true);
  });

  it('should return false on error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const healthy = await checkHealth('http://localhost:8000');

    expect(healthy).toBe(false);
  });
});
