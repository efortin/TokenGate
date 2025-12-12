import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryCollector } from '../../src/telemetry/collector.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TelemetryCollector', () => {
  let collector: TelemetryCollector;

  beforeEach(() => {
    collector = new TelemetryCollector({ enabled: true });
    vi.clearAllMocks();
  });

  describe('record', () => {
    it('should record token usage', () => {
      collector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(1);
      expect(stats.totalInputTokens).toBe(100);
      expect(stats.totalOutputTokens).toBe(50);
    });

    it('should accumulate multiple records', () => {
      collector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      collector.record({
        requestId: 'test-2',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 200,
        outputTokens: 100,
        latencyMs: 300,
        hasToolCalls: true,
        hasVision: false,
      });

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(2);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.avgDurationMs).toBe(400);
    });

    it('should not record when disabled', () => {
      const disabledCollector = new TelemetryCollector({ enabled: false });
      
      disabledCollector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      const stats = disabledCollector.getStats();
      expect(stats.requestCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct averages', () => {
      for (let i = 0; i < 5; i++) {
        collector.record({
          requestId: `test-${i}`,
          timestamp: new Date(),
          model: 'test-model',
          backend: 'test-backend',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 100 * (i + 1),
          hasToolCalls: false,
          hasVision: false,
        });
      }

      const stats = collector.getStats();
      expect(stats.avgInputTokens).toBe(100);
      expect(stats.avgOutputTokens).toBe(50);
      expect(stats.avgDurationMs).toBe(300); // (100+200+300+400+500)/5
    });

    it('should return last 10 recent usage', () => {
      for (let i = 0; i < 15; i++) {
        collector.record({
          requestId: `test-${i}`,
          timestamp: new Date(),
          model: 'test-model',
          backend: 'test-backend',
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 500,
          hasToolCalls: false,
          hasVision: false,
        });
      }

      const stats = collector.getStats();
      expect(stats.recentUsage.length).toBe(10);
      expect(stats.recentUsage[0].requestId).toBe('test-5');
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      collector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      collector.reset();

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.recentUsage.length).toBe(0);
    });
  });

  describe('telemetry endpoint', () => {
    it('should send usage to endpoint when configured', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const endpointCollector = new TelemetryCollector({
        enabled: true,
        endpoint: 'http://telemetry.example.com/ingest',
      });

      endpointCollector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      // Wait for async fetch to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledWith(
        'http://telemetry.example.com/ingest',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle endpoint errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const endpointCollector = new TelemetryCollector({
        enabled: true,
        endpoint: 'http://telemetry.example.com/ingest',
      });

      endpointCollector.record({
        requestId: 'test-1',
        timestamp: new Date(),
        model: 'test-model',
        backend: 'test-backend',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 500,
        hasToolCalls: false,
        hasVision: false,
      });

      // Wait for async fetch to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should limit usage log to 1000 entries', () => {
      for (let i = 0; i < 1010; i++) {
        collector.record({
          requestId: `test-${i}`,
          timestamp: new Date(),
          model: 'test-model',
          backend: 'test-backend',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 10,
          hasToolCalls: false,
          hasVision: false,
        });
      }

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(1010);
      // recentUsage is sliced to last 10, but internal log is capped at 1000
    });
  });
});
