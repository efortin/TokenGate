import {describe, it, expect, beforeEach, afterEach} from 'vitest';

import {loadConfig} from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default values when no env vars are set', () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.API_KEY;
    delete process.env.VLLM_URL;
    delete process.env.VLLM_API_KEY;
    delete process.env.VLLM_MODEL;
    delete process.env.LOG_LEVEL;

    const config = loadConfig();

    expect(config.port).toBe(3456);
    expect(config.host).toBe('0.0.0.0');
    expect(config.apiKey).toBe('');
    expect(config.defaultBackend.name).toBe('vllm');
    expect(config.defaultBackend.url).toBe('http://localhost:8000');
    expect(config.defaultBackend.apiKey).toBe('');
    expect(config.defaultBackend.model).toBe('');
    expect(config.logLevel).toBe('info');
  });

  it('should use environment variables when set', () => {
    process.env.PORT = '8080';
    process.env.HOST = '127.0.0.1';
    process.env.API_KEY = 'my-api-key';
    process.env.VLLM_URL = 'http://vllm:8000';
    process.env.VLLM_API_KEY = 'vllm-key';
    process.env.VLLM_MODEL = 'my-model';
    process.env.LOG_LEVEL = 'debug';

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.apiKey).toBe('my-api-key');
    expect(config.defaultBackend.url).toBe('http://vllm:8000');
    expect(config.defaultBackend.apiKey).toBe('vllm-key');
    expect(config.defaultBackend.model).toBe('my-model');
    expect(config.logLevel).toBe('debug');
  });

  it('should parse port as integer', () => {
    process.env.PORT = '9999';

    const config = loadConfig();

    expect(config.port).toBe(9999);
    expect(typeof config.port).toBe('number');
  });
});
