import { RouterConfigSchema, type RouterConfig } from './types/index.js';

/** Loads and validates configuration from environment variables. */
export function loadConfig(): RouterConfig {
  return RouterConfigSchema.parse({
    port: process.env.PORT,
    host: process.env.HOST,
    apiKey: process.env.API_KEY,
    defaultBackend: {
      name: process.env.BACKEND_NAME,
      url: process.env.VLLM_URL,
      apiKey: process.env.VLLM_API_KEY,
      model: process.env.VLLM_MODEL,
      temperature: process.env.TEMPERATURE,
    },
    logLevel: process.env.LOG_LEVEL,
    logPretty: process.env.LOG_PRETTY,
    logFilePath: process.env.LOG_FILE_PATH,
  });
}
