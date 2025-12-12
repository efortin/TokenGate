import { describe, it, expect, beforeEach } from 'vitest';
import { SSEEnricher } from '../../src/transform/sse-enricher.js';

describe('SSEEnricher', () => {
  let enricher: SSEEnricher;

  beforeEach(() => {
    enricher = new SSEEnricher({ estimatedInputTokens: 100 });
  });

  describe('processChunk', () => {
    it('should enrich message_start with usage', () => {
      const input = 'event: message_start\ndata: {"type":"message_start","message":{"id":"123","content":[],"model":"test"}}\n';
      const output = enricher.processChunk(input);

      expect(output).toContain('"usage":{"input_tokens":100,"output_tokens":0}');
      expect(output).toContain('"role":"assistant"');
      expect(output).toContain('"type":"message"');
    });

    it('should preserve existing usage', () => {
      const input = 'event: message_start\ndata: {"type":"message_start","message":{"id":"123","content":[],"model":"test","usage":{"input_tokens":50,"output_tokens":0}}}\n';
      const output = enricher.processChunk(input);

      expect(output).toContain('"input_tokens":50');
    });

    it('should pass through other events unchanged', () => {
      const input = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n';
      const output = enricher.processChunk(input);

      expect(output).toContain('content_block_delta');
      expect(output).toContain('"text":"Hello"');
    });

    it('should track tool calls', () => {
      enricher.processChunk('event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"123","name":"test"}}\n');

      const stats = enricher.getStats();
      expect(stats.hasToolCalls).toBe(true);
    });

    it('should track output tokens from message_delta', () => {
      enricher.processChunk('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":50}}\n');

      const stats = enricher.getStats();
      expect(stats.outputTokens).toBe(50);
    });
  });

  describe('flush', () => {
    it('should return remaining buffer', () => {
      enricher.processChunk('partial line without newline');
      const output = enricher.flush();

      expect(output).toContain('partial line');
    });

    it('should return empty for complete chunks', () => {
      enricher.processChunk('event: test\ndata: {}\n\n');
      const output = enricher.flush();

      expect(output).toBe('');
    });
  });

  describe('getStats', () => {
    it('should return accumulated stats', () => {
      enricher.processChunk('event: message_start\ndata: {"type":"message_start","message":{"id":"123","content":[],"model":"test"}}\n');
      enricher.processChunk('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":25}}\n');

      const stats = enricher.getStats();
      expect(stats.inputTokens).toBe(100);
      expect(stats.outputTokens).toBe(25);
      expect(stats.hasToolCalls).toBe(false);
    });
  });
});
