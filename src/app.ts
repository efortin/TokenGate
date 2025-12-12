import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import cors from '@fastify/cors';

import metricsPlugin from './plugins/metrics.js';
import anthropicRoutes from './routes/anthropic.js';
import openaiRoutes from './routes/openai.js';
import systemRoutes from './routes/system.js';
import type {AppConfig} from './types/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  logger?: boolean | object;
}

/** Creates and configures the Fastify application. */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const {config, logger = true} = options;

  const app = Fastify({
    logger:
      logger
        ? {
            level: config.logLevel,
            transport: {target: 'pino-pretty', options: {colorize: true}},
          }
        : logger,
  });

  app.decorate('config', config);

  await app.register(cors, {origin: true});
  await app.register(metricsPlugin);
  await app.register(systemRoutes);
  await app.register(anthropicRoutes);
  await app.register(openaiRoutes);

  return app;
}
