/**
 * Response transforms for cleaning vLLM responses.
 * Applied as a pipeline to sanitize responses before sending to clients.
 */

import type { AnthropicResponse } from '../types/index.js';
import type { Transformer } from './pipeline.js';

/** Content block types from Anthropic API */
interface TextBlock {
    type: 'text';
    text: string;
}

interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}

type ContentBlock = TextBlock | ToolUseBlock | { type: string };

/**
 * Removes empty text blocks from response content.
 * 
 * vLLM/Devstral sometimes generates empty text blocks before tool_use blocks:
 *   [{"type": "text", "text": ""}, {"type": "tool_use", ...}]
 * 
 * Anthropic clients expect non-empty text blocks, causing "(no content)" display.
 * This transform filters out empty text blocks to fix the issue.
 * 
 * @see https://github.com/anthropics/anthropic-sdk-python/issues/461
 * @see https://github.com/vercel/ai/issues/1831
 */
export const filterEmptyTextBlocks: Transformer<AnthropicResponse> = (response) => {
    if (!response.content || !Array.isArray(response.content)) {
        return response;
    }

    const filteredContent = response.content.filter((block: ContentBlock) => {
        // Keep all non-text blocks
        if (block.type !== 'text') return true;
        // Filter out empty text blocks
        const textBlock = block as TextBlock;
        return textBlock.text !== '';
    });

    // If all content was filtered, keep at least one empty block to maintain valid response
    if (filteredContent.length === 0 && response.content.length > 0) {
        return response;
    }

    return { ...response, content: filteredContent };
};
