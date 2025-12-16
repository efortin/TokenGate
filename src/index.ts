import 'dotenv/config';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { discoverModels, checkHealth } from './services/backend.js';
import type { AppConfig } from './types/index.js';

async function main(): Promise<void> {
  const rawConfig = loadConfig();

  const config: AppConfig = {
    port: rawConfig.port,
    host: rawConfig.host,
    apiKey: rawConfig.apiKey,
    defaultBackend: {
      name: rawConfig.defaultBackend.name,
      url: rawConfig.defaultBackend.url,
      apiKey: rawConfig.defaultBackend.apiKey,
      model: rawConfig.defaultBackend.model,
    },
    logLevel: rawConfig.logLevel,
  };

  const app = await buildApp({
    config,
    logLevel: rawConfig.logLevel,
    logPretty: rawConfig.logPretty,
    logFilePath: rawConfig.logFilePath,
  });

  const healthy = await checkHealth(config.defaultBackend.url);
  if (!healthy) {
    app.log.warn({ url: config.defaultBackend.url }, 'Backend health check failed');
  }

  if (!config.defaultBackend.model) {
    const models = await discoverModels(
      config.defaultBackend.url,
      config.defaultBackend.apiKey,
    );
    if (models.length > 0) {
      config.defaultBackend.model = models[0];
      app.log.info({ model: config.defaultBackend.model }, 'Using discovered model');
    } else {
      app.log.error('No model configured and failed to discover models from backend');
      app.log.error('Set VLLM_MODEL environment variable or ensure backend is reachable');
      process.exit(1);
    }
  }

  await app.listen({ host: config.host, port: config.port });

  app.log.info(
    {
      host: config.host,
      port: config.port,
      backend: config.defaultBackend.url,
      model: config.defaultBackend.model,
      logFile: rawConfig.logFilePath,
    },
    'Server started',
  );
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
