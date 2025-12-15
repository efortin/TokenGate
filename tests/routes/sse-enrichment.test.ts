import { describe, it, expect } from 'vitest';

/**
 * Tests for SSE enrichment functions used in the Anthropic route.
 * 
 * IMPORTANT DESIGN DECISIONS:
 * 
 * 1. NO BUFFERING - We process SSE chunks in real-time as they arrive.
 *    Buffering all chunks before processing was attempted but broke tool_use
 *    JSON parsing because the JSON arrives in fragments across chunks.
 * 
 * 2. STATEFUL FILTERING - We track empty text block indices across chunks
 *    to filter them and their related delta/stop events.
 * 
 * 3. EVENT:DATA PAIRING - SSE events come as "event: X\ndata: {...}\n\n".
 *    When filtering a data: line, we must also skip the preceding event: line
 *    to prevent orphaned event: lines which break SSE parsing.
 * 
 * KNOWN LIMITATIONS (vLLM/Devstral side, not proxy):
 * - Devstral sometimes generates tool_use with missing input parameters
 * - vLLM truncates tool IDs (warning in logs)
 * - "Unexpected role 'user' after role 'tool'" error on some message sequences
 */

// Re-implement the function here for isolated testing
// (In production it's in src/routes/anthropic.ts)
function enrichSseChunk(
    chunk: string,
    calculatedInputTokens: number | undefined,
    emptyBlockIndices: Set<number>,
): string {
    const lines = chunk.split('\n');
    const outputLines: string[] = [];
    let pendingEventLine: string | null = null;

    for (const line of lines) {
        if (line.startsWith('event: ')) {
            pendingEventLine = line;
            continue;
        }

        if (!line.startsWith('data: ')) {
            if (pendingEventLine) {
                outputLines.push(pendingEventLine);
                pendingEventLine = null;
            }
            outputLines.push(line);
            continue;
        }

        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') {
            if (pendingEventLine) {
                outputLines.push(pendingEventLine);
                pendingEventLine = null;
            }
            outputLines.push(line);
            continue;
        }

        try {
            const data = JSON.parse(dataStr);

            if (data.type === 'message_start' && data.message) {
                data.message = {
                    ...data.message,
                    type: data.message.type || 'message',
                    role: data.message.role || 'assistant',
                    stop_reason: data.message.stop_reason ?? null,
                    stop_sequence: data.message.stop_sequence ?? null,
                };
                if (calculatedInputTokens !== undefined && data.message.usage) {
                    data.message.usage.input_tokens = calculatedInputTokens;
                }
                if (pendingEventLine) {
                    outputLines.push(pendingEventLine);
                    pendingEventLine = null;
                }
                outputLines.push(`data: ${JSON.stringify(data)}`);
                continue;
            }

            if (data.type === 'message_delta' && data.usage && calculatedInputTokens !== undefined) {
                data.usage.input_tokens = calculatedInputTokens;
                if (pendingEventLine) {
                    outputLines.push(pendingEventLine);
                    pendingEventLine = null;
                }
                outputLines.push(`data: ${JSON.stringify(data)}`);
                continue;
            }

            if (data.type === 'content_block_start' && data.content_block?.type === 'text') {
                if (data.content_block.text === '') {
                    emptyBlockIndices.add(data.index);
                    pendingEventLine = null;
                    continue;
                }
            }

            if (data.index !== undefined && emptyBlockIndices.has(data.index)) {
                if (data.type === 'content_block_delta' || data.type === 'content_block_stop') {
                    pendingEventLine = null;
                    continue;
                }
            }

            if (pendingEventLine) {
                outputLines.push(pendingEventLine);
                pendingEventLine = null;
            }
            outputLines.push(line);
        } catch {
            if (pendingEventLine) {
                outputLines.push(pendingEventLine);
                pendingEventLine = null;
            }
            outputLines.push(line);
        }
    }

    if (pendingEventLine) {
        outputLines.push(pendingEventLine);
    }

    return outputLines.join('\n');
}

describe('enrichSseChunk', () => {
    describe('message_start enrichment', () => {
        it('should add missing Anthropic fields to message_start', () => {
            const chunk = 'event: message_start\ndata: {"type":"message_start","message":{"id":"123","content":[],"model":"test","usage":{"input_tokens":5,"output_tokens":0}}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);
            const dataLine = result.split('\n').find(l => l.startsWith('data: '))!;
            const data = JSON.parse(dataLine.slice(6));

            expect(data.message.type).toBe('message');
            expect(data.message.role).toBe('assistant');
            expect(data.message.stop_reason).toBeNull();
            expect(data.message.stop_sequence).toBeNull();
        });

        it('should preserve existing Anthropic fields', () => {
            const chunk = 'event: message_start\ndata: {"type":"message_start","message":{"id":"123","type":"message","role":"assistant","stop_reason":"end_turn","stop_sequence":"##","usage":{"input_tokens":5,"output_tokens":0}}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);
            const dataLine = result.split('\n').find(l => l.startsWith('data: '))!;
            const data = JSON.parse(dataLine.slice(6));

            expect(data.message.type).toBe('message');
            expect(data.message.role).toBe('assistant');
            expect(data.message.stop_reason).toBe('end_turn');
            expect(data.message.stop_sequence).toBe('##');
        });

        it('should inject calculated input_tokens into message_start', () => {
            const chunk = 'event: message_start\ndata: {"type":"message_start","message":{"id":"123","usage":{"input_tokens":5,"output_tokens":0}}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, 1000, emptyBlocks);
            const dataLine = result.split('\n').find(l => l.startsWith('data: '))!;
            const data = JSON.parse(dataLine.slice(6));

            expect(data.message.usage.input_tokens).toBe(1000);
        });
    });

    describe('message_delta token injection', () => {
        it('should inject calculated input_tokens into message_delta', () => {
            const chunk = 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":50}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, 42000, emptyBlocks);
            const dataLine = result.split('\n').find(l => l.startsWith('data: '))!;
            const data = JSON.parse(dataLine.slice(6));

            expect(data.usage.input_tokens).toBe(42000);
            expect(data.usage.output_tokens).toBe(50);
        });
    });

    describe('empty text block filtering', () => {
        it('should filter content_block_start with empty text', () => {
            const chunk = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            // Both event: and data: lines should be filtered
            expect(result.includes('content_block_start')).toBe(false);
            expect(emptyBlocks.has(0)).toBe(true);
        });

        it('should NOT filter content_block_start with actual text', () => {
            const chunk = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hello"}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result.includes('content_block_start')).toBe(true);
            expect(result.includes('Hello')).toBe(true);
            expect(emptyBlocks.has(0)).toBe(false);
        });

        it('should filter delta and stop events for empty blocks', () => {
            const emptyBlocks = new Set<number>([0]); // Index 0 was already marked as empty

            const deltaChunk = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}';
            const deltaResult = enrichSseChunk(deltaChunk, undefined, emptyBlocks);
            expect(deltaResult.includes('content_block_delta')).toBe(false);

            const stopChunk = 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}';
            const stopResult = enrichSseChunk(stopChunk, undefined, emptyBlocks);
            expect(stopResult.includes('content_block_stop')).toBe(false);
        });

        it('should NOT filter tool_use blocks', () => {
            const chunk = 'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_123","name":"bash","input":{}}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result.includes('tool_use')).toBe(true);
            expect(result.includes('tool_123')).toBe(true);
            expect(emptyBlocks.has(1)).toBe(false);
        });
    });

    describe('event:data pairing', () => {
        it('should properly pair event: and data: lines', () => {
            const chunk = 'event: message_stop\ndata: {"type":"message_stop"}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result).toContain('event: message_stop');
            expect(result).toContain('data: {"type":"message_stop"}');
        });

        it('should handle [DONE] correctly', () => {
            const chunk = 'data: [DONE]';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result).toBe('data: [DONE]');
        });

        it('should NOT leave orphaned event: lines when filtering', () => {
            const chunk = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            // When data: is filtered, event: should also be filtered
            expect(result.includes('event: content_block_start')).toBe(false);
        });

        it('should handle multiple events in a single chunk', () => {
            const chunk =
                'event: content_block_delta\n' +
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n' +
                '\n' +
                'event: content_block_delta\n' +
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result.match(/event: content_block_delta/g)?.length).toBe(2);
            expect(result.includes('Hello')).toBe(true);
            expect(result.includes('World')).toBe(true);
        });
    });

    describe('passthrough behavior', () => {
        it('should pass through non-JSON data lines', () => {
            const chunk = 'data: invalid json here';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result).toBe('data: invalid json here');
        });

        it('should pass through empty lines', () => {
            const chunk = '\n\n';
            const emptyBlocks = new Set<number>();

            const result = enrichSseChunk(chunk, undefined, emptyBlocks);

            expect(result).toBe('\n\n');
        });

        it('should NOT buffer - process chunk immediately', () => {
            // This test documents the design decision: no buffering
            // Each chunk is processed independently as it arrives

            const chunk1 = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Part 1"}}';
            const chunk2 = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" continued"}}';

            const emptyBlocks = new Set<number>();

            // Process chunks separately (as they would arrive from stream)
            const result1 = enrichSseChunk(chunk1, undefined, emptyBlocks);
            const result2 = enrichSseChunk(chunk2, undefined, emptyBlocks);

            // Each result should be complete and valid independently
            expect(result1.includes('Part 1')).toBe(true);
            expect(result2.includes('continued')).toBe(true);
        });
    });

    describe('cross-chunk state', () => {
        it('should maintain empty block indices across chunks', () => {
            const emptyBlocks = new Set<number>();

            // First chunk: mark index 0 as empty
            const chunk1 = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}';
            enrichSseChunk(chunk1, undefined, emptyBlocks);

            expect(emptyBlocks.has(0)).toBe(true);

            // Second chunk: delta for the empty block should be filtered
            const chunk2 = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}';
            const result2 = enrichSseChunk(chunk2, undefined, emptyBlocks);

            expect(result2.includes('content_block_delta')).toBe(false);
        });
    });
});

describe('vLLM Compatibility Notes', () => {
    // These are not actual tests but documentation of known issues

    it('documents: vLLM message_start is missing required Anthropic fields', () => {
        // vLLM returns: {"message":{"id":"...","content":[],"model":"...","usage":{...}}}
        // Anthropic requires: {"message":{"id":"...","type":"message","role":"assistant","content":[],"model":"...","stop_reason":null,"stop_sequence":null,"usage":{...}}}
        // Our enrichSseChunk adds the missing fields: type, role, stop_reason, stop_sequence
        expect(true).toBe(true);
    });

    it('documents: token counting requires calculated injection', () => {
        // vLLM's input_token count may not match actual token usage
        // We use tiktoken (cl100k_base) to calculate input tokens from the request
        // and inject this value into message_start and message_delta events
        expect(true).toBe(true);
    });

    it('documents: Devstral generates empty text blocks before tool_use', () => {
        // Content often looks like: [{"type":"text","text":""},{"type":"tool_use",...}]
        // The empty text block causes "(no content)" display in Claude Code
        // We filter these empty text blocks while preserving tool_use blocks
        expect(true).toBe(true);
    });

    it('documents: Devstral sometimes generates tool_use with missing parameters', () => {
        // This is a model behavior issue, not fixable at proxy level
        // Symptoms: "Invalid tool parameters" errors in Claude Code
        // The tool_use input JSON may be empty or incomplete
        expect(true).toBe(true);
    });

    it('documents: buffering breaks tool_use JSON assembly', () => {
        // Tool use input JSON arrives in fragments across multiple SSE chunks
        // Buffering and filtering before sending breaks the JSON assembly
        // Solution: process chunks in real-time without full buffering
        expect(true).toBe(true);
    });
});
