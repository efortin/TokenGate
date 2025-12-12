import type { AnthropicRequest, BackendConfig, OpenAIRequest, RouterConfig } from '../types/index.js';

export class BackendSelector {
  private defaultBackend: BackendConfig;
  private visionBackend?: BackendConfig;

  constructor(config: RouterConfig) {
    this.defaultBackend = config.defaultBackend;
    this.visionBackend = config.visionBackend;
  }

  select(request: AnthropicRequest): BackendConfig {
    if (this.hasAnthropicVision(request) && this.visionBackend) {
      return this.visionBackend;
    }
    return this.defaultBackend;
  }

  selectForOpenAI(request: OpenAIRequest): BackendConfig {
    if (this.hasOpenAIVision(request) && this.visionBackend) {
      return this.visionBackend;
    }
    return this.defaultBackend;
  }

  hasAnthropicVision(request: AnthropicRequest): boolean {
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image') return true;
        }
      }
    }
    return false;
  }

  hasOpenAIVision(request: OpenAIRequest): boolean {
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url' && part.image_url?.url) return true;
        }
      }
    }
    return false;
  }
}
