import type { AnthropicRequest, BackendConfig, RouterConfig } from '../types/index.js';

export class BackendSelector {
  private defaultBackend: BackendConfig;
  private visionBackend?: BackendConfig;

  constructor(config: RouterConfig) {
    this.defaultBackend = config.defaultBackend;
    this.visionBackend = config.visionBackend;
  }

  select(request: AnthropicRequest): BackendConfig {
    if (this.hasVisionContent(request) && this.visionBackend) {
      return this.visionBackend;
    }
    return this.defaultBackend;
  }

  hasVisionContent(request: AnthropicRequest): boolean {
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image') return true;
        }
      }
    }
    return false;
  }
}
