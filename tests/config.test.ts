import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
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
    delete process.env.VISION_URL;
    delete process.env.TELEMETRY_ENABLED;
    delete process.env.LOG_LEVEL;

    const config = loadConfig();

    expect(config.port).toBe(3456);
    expect(config.host).toBe('0.0.0.0');
    expect(config.apiKey).toBe('sk-anthropic-router');
    expect(config.defaultBackend.name).toBe('vllm');
    expect(config.defaultBackend.url).toBe('http://localhost:8000');
    expect(config.defaultBackend.apiKey).toBe('');
    expect(config.defaultBackend.model).toBe('qwen3-coder-30b-fp8');
    expect(config.visionBackend).toBeUndefined();
    expect(config.telemetry.enabled).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('should use environment variables when set', () => {
    process.env.PORT = '8080';
    process.env.HOST = '127.0.0.1';
    process.env.API_KEY = 'my-api-key';
    process.env.VLLM_URL = 'http://vllm:8000';
    process.env.VLLM_API_KEY = 'vllm-key';
    process.env.VLLM_MODEL = 'my-model';
    process.env.TELEMETRY_ENABLED = 'true';
    process.env.TELEMETRY_ENDPOINT = 'http://telemetry';
    process.env.LOG_LEVEL = 'debug';

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.apiKey).toBe('my-api-key');
    expect(config.defaultBackend.url).toBe('http://vllm:8000');
    expect(config.defaultBackend.apiKey).toBe('vllm-key');
    expect(config.defaultBackend.model).toBe('my-model');
    expect(config.telemetry.enabled).toBe(true);
    expect(config.telemetry.endpoint).toBe('http://telemetry');
    expect(config.logLevel).toBe('debug');
  });

  it('should configure vision backend when VISION_URL is set', () => {
    process.env.VISION_URL = 'http://vision:8000';
    process.env.VISION_API_KEY = 'vision-key';
    process.env.VISION_MODEL = 'gpt-4-vision-preview';

    const config = loadConfig();

    expect(config.visionBackend).toBeDefined();
    expect(config.visionBackend?.name).toBe('vision');
    expect(config.visionBackend?.url).toBe('http://vision:8000');
    expect(config.visionBackend?.apiKey).toBe('vision-key');
    expect(config.visionBackend?.model).toBe('gpt-4-vision-preview');
  });

  it('should use default vision model when not specified', () => {
    process.env.VISION_URL = 'http://vision:8000';
    delete process.env.VISION_MODEL;

    const config = loadConfig();

    expect(config.visionBackend?.model).toBe('gpt-4-vision');
  });

  it('should parse port as integer', () => {
    process.env.PORT = '9999';

    const config = loadConfig();

    expect(config.port).toBe(9999);
    expect(typeof config.port).toBe('number');
  });
});
