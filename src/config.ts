import type {RouterConfig} from './types/index.js';

/** Loads configuration from environment variables. */
export function loadConfig(): RouterConfig {
  return {
    port: parseInt(process.env.PORT ?? '3456', 10),
    host: process.env.HOST ?? '0.0.0.0',
    apiKey: process.env.API_KEY ?? '',
    defaultBackend: {
      name: 'vllm',
      url: process.env.VLLM_URL ?? 'http://localhost:8000',
      apiKey: process.env.VLLM_API_KEY ?? '',
      model: process.env.VLLM_MODEL ?? '',
    },
    visionBackend: process.env.VISION_URL
      ? {
          name: 'vision',
          url: process.env.VISION_URL,
          apiKey: process.env.VISION_API_KEY ?? process.env.VLLM_API_KEY ?? '',
          model: process.env.VISION_MODEL ?? '',
        }
      : undefined,
    logLevel: (process.env.LOG_LEVEL as RouterConfig['logLevel']) ?? 'info',
  };
}
