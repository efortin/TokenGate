import type { RouterConfig } from './types/index.js';

export function loadConfig(): RouterConfig {
  return {
    port: parseInt(process.env.PORT || '3456', 10),
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || 'sk-anthropic-router',
    
    defaultBackend: {
      name: 'vllm',
      url: process.env.VLLM_URL || 'http://localhost:8000',
      apiKey: process.env.VLLM_API_KEY || '',
      model: process.env.VLLM_MODEL || 'qwen3-coder-30b-fp8',
    },

    
    visionBackend: process.env.VISION_URL ? {
      name: 'vision',
      url: process.env.VISION_URL,
      apiKey: process.env.VISION_API_KEY || '',
      model: process.env.VISION_MODEL || 'gpt-4-vision',
    } : undefined,
    
    telemetry: {
      enabled: process.env.TELEMETRY_ENABLED === 'true',
      endpoint: process.env.TELEMETRY_ENDPOINT,
    },
    
    logLevel: (process.env.LOG_LEVEL as RouterConfig['logLevel']) || 'info',
  };
}
