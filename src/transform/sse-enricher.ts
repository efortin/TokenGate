import type { AnthropicStreamEvent } from '../types/index.js';

export interface SSEEnricherOptions {
  estimatedInputTokens: number;
}

export interface SSEParseResult {
  enrichedChunk: string;
  inputTokens: number;
  outputTokens: number;
  hasToolCalls: boolean;
}

export class SSEEnricher {
  private options: SSEEnricherOptions;
  private buffer = '';
  private inputTokens = 0;
  private outputTokens = 0;
  private hasToolCalls = false;

  constructor(options: SSEEnricherOptions) {
    this.options = options;
  }

  processChunk(chunk: string): string {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    let output = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Handle event: + data: pairs
      if (line.startsWith('event: ')) {
        const nextLine = lines[i + 1];

        if (nextLine?.startsWith('data: ')) {
          try {
            const event = JSON.parse(nextLine.slice(6)) as AnthropicStreamEvent;
            const enriched = this.enrichEvent(event);

            if (enriched) {
              output += `event: ${event.type}\ndata: ${JSON.stringify(enriched)}\n\n`;
              i += 2;
              continue;
            }
          } catch {
            // Not JSON, pass through
          }

          // Pass through event + data pair
          output += `${line}\n${nextLine}\n\n`;
          i += 2;
          continue;
        }
      }

      // Pass through standalone lines
      if (line.trim()) {
        output += line + '\n';
      }
      i++;
    }

    return output;
  }

  flush(): string {
    if (this.buffer.trim()) {
      return this.buffer + '\n';
    }
    return '';
  }

  private enrichEvent(event: AnthropicStreamEvent): AnthropicStreamEvent | null {
    // Enrich message_start with usage if missing
    if (event.type === 'message_start' && event.message) {
      if (!event.message.usage) {
        event.message.usage = {
          input_tokens: this.options.estimatedInputTokens,
          output_tokens: 0,
        };
      }
      if (!event.message.role) event.message.role = 'assistant';
      if (!event.message.type) event.message.type = 'message';
      if (event.message.stop_reason === undefined) event.message.stop_reason = null;
      if (event.message.stop_sequence === undefined) event.message.stop_sequence = null;

      this.inputTokens = event.message.usage.input_tokens || this.options.estimatedInputTokens;
      return event;
    }

    // Track telemetry
    if (event.usage?.output_tokens) {
      this.outputTokens = event.usage.output_tokens;
    }
    if (event.content_block?.type === 'tool_use') {
      this.hasToolCalls = true;
    }

    return null; // Return null to indicate no enrichment needed
  }

  getStats(): { inputTokens: number; outputTokens: number; hasToolCalls: boolean } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      hasToolCalls: this.hasToolCalls,
    };
  }
}
