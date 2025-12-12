import type { TokenUsage, TelemetryConfig } from '../types/index.js';

export class TelemetryCollector {
  private config: TelemetryConfig;
  private usageLog: TokenUsage[] = [];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private requestCount = 0;

  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  record(usage: Omit<TokenUsage, 'totalTokens'>): void {
    if (!this.config.enabled) return;

    const fullUsage: TokenUsage = {
      ...usage,
      latencyMs: usage.latencyMs,
    };

    this.usageLog.push(fullUsage);
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.requestCount++;

    // Keep only last 1000 entries in memory
    if (this.usageLog.length > 1000) {
      this.usageLog = this.usageLog.slice(-1000);
    }

    // Send to external endpoint if configured
    if (this.config.endpoint) {
      this.sendToEndpoint(fullUsage).catch(console.error);
    }
  }

  private async sendToEndpoint(usage: TokenUsage): Promise<void> {
    if (!this.config.endpoint) return;

    try {
      await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(usage),
      });
    } catch (e) {
      console.error('Failed to send telemetry:', e);
    }
  }

  getStats() {
    const avgDuration = this.usageLog.length > 0
      ? this.usageLog.reduce((sum, u) => sum + u.latencyMs, 0) / this.usageLog.length
      : null;

    return {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      requestCount: this.requestCount,
      avgInputTokens: this.requestCount > 0 ? this.totalInputTokens / this.requestCount : 0,
      avgOutputTokens: this.requestCount > 0 ? this.totalOutputTokens / this.requestCount : 0,
      avgDurationMs: avgDuration,
      recentUsage: this.usageLog.slice(-10),
    };
  }

  reset(): void {
    this.usageLog = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.requestCount = 0;
  }
}
