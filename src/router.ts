import type { AnthropicRequest, AnthropicResponse, OpenAIRequest, OpenAIResponse, RouterConfig } from './types/index.js';
import { TelemetryCollector } from './telemetry/index.js';
import { BackendSelector } from './routing/index.js';
import { countTokens } from './transform/index.js';
import {
  handleAnthropicRequest as anthropicHandler,
  handleAnthropicStreamingRequest as anthropicStreamHandler,
  handleOpenAIRequest as openaiHandler,
  handleOpenAIStreamingRequest as openaiStreamHandler,
} from './handlers/index.js';

// Re-export for backwards compatibility
export { countTokens };

export class AnthropicRouter {
  private config: RouterConfig;
  private telemetry: TelemetryCollector;
  private backendSelector: BackendSelector;

  constructor(config: RouterConfig) {
    this.config = config;
    this.telemetry = new TelemetryCollector(config.telemetry);
    this.backendSelector = new BackendSelector(config);
  }

  getTelemetryStats() {
    return this.telemetry.getStats();
  }

  async handleAnthropicRequest(request: AnthropicRequest): Promise<AnthropicResponse> {
    const backend = this.backendSelector.select(request);
    return anthropicHandler(request, {
      backend,
      onTelemetry: (usage) => this.telemetry.record(usage),
    });
  }

  async *handleAnthropicStreamingRequest(request: AnthropicRequest): AsyncGenerator<string> {
    const backend = this.backendSelector.select(request);
    yield* anthropicStreamHandler(request, {
      backend,
      onTelemetry: (usage) => this.telemetry.record(usage),
    });
  }

  async handleOpenAIRequest(request: OpenAIRequest): Promise<OpenAIResponse> {
    const backend = this.config.defaultBackend;
    return openaiHandler(request, {
      backend,
      onTelemetry: (usage) => this.telemetry.record(usage),
    });
  }

  async *handleOpenAIStreamingRequest(request: OpenAIRequest): AsyncGenerator<string> {
    const backend = this.config.defaultBackend;
    yield* openaiStreamHandler(request, {
      backend,
      onTelemetry: (usage) => this.telemetry.record(usage),
    });
  }
}
