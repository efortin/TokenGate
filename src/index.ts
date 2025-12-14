import 'dotenv/config';
import pino from 'pino';

import {buildApp} from './app.js';
import {loadConfig} from './config.js';
import {discoverModels, checkHealth} from './services/backend.js';
import type {AppConfig} from './types/index.js';

const logger = pino({level: 'info'});

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
    visionBackend: rawConfig.visionBackend,
    logLevel: rawConfig.logLevel,
  };

  const healthy = await checkHealth(config.defaultBackend.url);
  if (!healthy) {
    logger.warn({url: config.defaultBackend.url}, 'Backend health check failed');
  }

  if (!config.defaultBackend.model) {
    const models = await discoverModels(
      config.defaultBackend.url,
      config.defaultBackend.apiKey,
    );
    if (models.length > 0) {
      config.defaultBackend.model = models[0];
      logger.info({model: config.defaultBackend.model}, 'Using discovered model');
    }
  }

  // Discover vision model if not configured
  if (config.visionBackend && !config.visionBackend.model) {
    const visionModels = await discoverModels(
      config.visionBackend.url,
      config.visionBackend.apiKey,
    );
    if (visionModels.length > 0) {
      config.visionBackend.model = visionModels[0];
      logger.info({model: config.visionBackend.model}, 'Using discovered vision model');
    }
  }

  const app = await buildApp({config});
  await app.listen({host: config.host, port: config.port});

  logger.info(
    {
      host: config.host,
      port: config.port,
      backend: config.defaultBackend.url,
      model: config.defaultBackend.model,
    },
    'Server started',
  );
}

main().catch((err) => {
  logger.error({err}, 'Failed to start server');
  process.exit(1);
});
