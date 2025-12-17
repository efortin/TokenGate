import type { RouterConfig } from './types/index.js';

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
      temperature: process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined,
    },
    logLevel: (process.env.LOG_LEVEL as RouterConfig['logLevel']) ?? 'info',
    logPretty: process.env.LOG_PRETTY === 'true',
    logFilePath: process.env.LOG_FILE_PATH,
  };
}
