import { describe, it, expect } from 'vitest';
import { normalizeOpenAIToolIds, filterEmptyAssistantMessages, ensureMistralMessageOrder } from '../../src/utils/convert.js';
import { pipe } from '../../src/utils/pipeline.js';
import type { AnthropicRequest } from '../../src/types/index.js';

describe('ensureMistralMessageOrder', () => {
    it('should insert assistant message when user follows tool', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'List files' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: 'file1.txt\nfile2.txt' },
                { role: 'user', content: 'Now analyze these files' },
            ],
        };

        const result = ensureMistralMessageOrder(req);

        // Should have: user, assistant (tool_calls), tool, assistant (inserted), user
        expect(result.messages).toHaveLength(5);
        expect(result.messages[3].role).toBe('assistant');
        expect(result.messages[3].content).toBe('Understood.');
        expect(result.messages[4].role).toBe('user');
    });

    it('should handle multiple tool messages followed by user', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'Test' },
                {
                    role: 'assistant', content: null, tool_calls: [
                        { id: 'call_1', type: 'function', function: { name: 'fn1', arguments: '{}' } },
                        { id: 'call_2', type: 'function', function: { name: 'fn2', arguments: '{}' } },
                    ]
                },
                { role: 'tool', tool_call_id: 'call_1', content: 'result1' },
                { role: 'tool', tool_call_id: 'call_2', content: 'result2' },
                { role: 'user', content: 'Continue' },
            ],
        };

        const result = ensureMistralMessageOrder(req);

        // Should insert assistant after last tool and before user
        expect(result.messages).toHaveLength(6);
        expect(result.messages[4].role).toBe('assistant');
        expect(result.messages[4].content).toBe('Understood.');
        expect(result.messages[5].role).toBe('user');
    });

    it('should not modify valid sequences (tool -> assistant)', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'Test' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: 'result' },
                { role: 'assistant', content: 'Based on the results...' },
            ],
        };

        const result = ensureMistralMessageOrder(req);

        // Should not insert anything, sequence is already valid
        expect(result.messages).toHaveLength(4);
        expect(result.messages).toEqual(req.messages);
    });

    it('should not modify sequences without tool messages', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi' },
                { role: 'user', content: 'How are you?' },
            ],
        };

        const result = ensureMistralMessageOrder(req);

        expect(result.messages).toHaveLength(3);
        expect(result.messages).toEqual(req.messages);
    });

    it('should handle tool message at the end (valid)', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'Test' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: 'result' },
            ],
        };

        const result = ensureMistralMessageOrder(req);

        // Tool at the end is valid, no insertion needed
        expect(result.messages).toHaveLength(3);
        expect(result.messages).toEqual(req.messages);
    });

    it('should work with the full transformation pipeline', () => {
        const req = {
            model: 'devstral',
            messages: [
                { role: 'user', content: 'List files' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_very_long_id', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
                { role: 'tool', tool_call_id: 'call_very_long_id', content: 'file1.txt' },
                { role: 'user', content: 'Analyze' },
            ],
        };

        // Apply the full pipeline
        const result = pipe(
            filterEmptyAssistantMessages,
            normalizeOpenAIToolIds,
            ensureMistralMessageOrder,
        )(req);

        // Should have normalized IDs and inserted assistant message
        expect(result.messages).toHaveLength(5);
        expect(result.messages[3].role).toBe('assistant');
        expect(result.messages[3].content).toBe('Understood.');

        // IDs should be normalized to 9 chars
        const assistantMsg = result.messages[1] as { tool_calls?: { id: string }[] };
        const toolMsg = result.messages[2] as { tool_call_id?: string };
        expect(assistantMsg.tool_calls?.[0].id).toHaveLength(9);
        expect(toolMsg.tool_call_id).toBe(assistantMsg.tool_calls?.[0].id);
    });
});
