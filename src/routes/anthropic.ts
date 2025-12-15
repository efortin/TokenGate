import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AnthropicRequest, AnthropicResponse } from '../types/index.js';
import { callBackend, streamBackend } from '../services/backend.js';
import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
  getBackendAuth,
  calculateTokenCount,
  pipe,
} from '../utils/index.js';
import { filterEmptyTextBlocks } from '../utils/response-transforms.js';

// ============================================================================
// Preprocessing - vLLM compatibility fixes
// ============================================================================

/** 
 * Fixes vLLM bug: copies tool_use_id to id field for tool_result blocks.
 * vLLM reads block.id instead of block.tool_use_id for tool_result.
 * See: vllm/entrypoints/anthropic/serving_messages.py:140
 */
function normalizeToolIds(req: AnthropicRequest): AnthropicRequest {
  const messages = req.messages.map((msg) => {
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const content = msg.content.map((block) => {
      if (block.type === 'tool_result') {
        const toolUseId = (block as { tool_use_id?: string }).tool_use_id;
        if (toolUseId) {
          return { ...block, id: toolUseId };
        }
      }
      return block;
    });
    return { ...msg, content };
  });

  return { ...req, messages };
}

/** Ensures last message is not from assistant (vLLM requirement). */
function fixTrailingAssistant(req: AnthropicRequest): AnthropicRequest {
  const lastMsg = req.messages[req.messages.length - 1];
  if (lastMsg?.role === 'assistant') {
    return {
      ...req,
      messages: [...req.messages, { role: 'user', content: 'Continue.' }],
    };
  }
  return req;
}

// ============================================================================
// Pipelines - Request preprocessing and Response postprocessing
// ============================================================================

/** Request preprocessing pipeline - fixes vLLM compatibility issues */
const preprocessRequest = pipe<AnthropicRequest>(
  normalizeToolIds,
  fixTrailingAssistant,
);

/** Response postprocessing pipeline - cleans vLLM responses */
const postprocessResponse = pipe<AnthropicResponse>(
  filterEmptyTextBlocks,
);

// ============================================================================
// Route - Passthrough to vLLM Anthropic endpoint
// ============================================================================

async function anthropicRoutes(app: FastifyInstance): Promise<void> {
  // Token counting endpoint (like claude-code-router)
  app.post('/v1/messages/count_tokens', async (req: FastifyRequest) => {
    const { messages, tools, system } = req.body as {
      messages?: unknown[];
      tools?: unknown[];
      system?: unknown;
    };
    const tokenCount = calculateTokenCount(
      (messages || []) as Parameters<typeof calculateTokenCount>[0],
      system as Parameters<typeof calculateTokenCount>[1],
      tools as Parameters<typeof calculateTokenCount>[2],
    );
    return { input_tokens: tokenCount };
  });

  app.post('/v1/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawBody = req.body as AnthropicRequest;
    const body = preprocessRequest(rawBody);
    const backend = app.config.defaultBackend;
    const baseUrl = backend.url as string;
    const auth = getBackendAuth(backend, req.headers.authorization) ?? '';
    const model = backend.model || body.model;

    const payload = { ...body, model };

    // Debug: log outgoing request
    req.log.debug({
      messageCount: payload.messages?.length,
      lastMessage: payload.messages?.[payload.messages.length - 1],
      toolCount: (payload as { tools?: unknown[] }).tools?.length,
      maxTokens: payload.max_tokens,
      stream: payload.stream,
    }, 'Outgoing request to vLLM');

    try {
      if (body.stream) return streamAnthropic(reply, baseUrl, payload, auth);
      const rawResponse = await callBackend<AnthropicResponse>(`${baseUrl}/v1/messages`, payload, auth);
      const response = postprocessResponse(rawResponse);

      // Debug: log response
      req.log.debug({
        stopReason: response.stop_reason,
        contentLength: response.content?.length,
        content: response.content,
        usage: response.usage,
      }, 'Response from vLLM');

      return response;
    } catch (e) {
      req.log.error({ err: e }, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(e instanceof Error ? e.message : 'Unknown error');
    }
  });
}

// ============================================================================
// Streaming - Passthrough SSE with filtering
// ============================================================================

/**
 * Filters SSE chunks to remove empty text content blocks.
 * Tracks indices of empty text blocks and filters their related events.
 */
function* filterSseEmptyTextBlocks(chunks: string[]): Generator<string> {
  const emptyBlockIndices = new Set<number>();

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const outputLines: string[] = [];

    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        outputLines.push(line);
        continue;
      }

      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') {
        outputLines.push(line);
        continue;
      }

      try {
        const data = JSON.parse(dataStr);

        // Track empty text blocks on content_block_start
        if (data.type === 'content_block_start' && data.content_block?.type === 'text') {
          if (data.content_block.text === '') {
            emptyBlockIndices.add(data.index);
            continue; // Skip this event
          }
        }

        // Skip events for tracked empty blocks
        if (data.index !== undefined && emptyBlockIndices.has(data.index)) {
          if (data.type === 'content_block_delta' || data.type === 'content_block_stop') {
            continue;
          }
        }

        outputLines.push(line);
      } catch {
        // Not valid JSON, pass through
        outputLines.push(line);
      }
    }

    const output = outputLines.join('\n');
    if (output.trim()) {
      yield output;
    }
  }
}

const streamAnthropic = async (
  reply: FastifyReply,
  baseUrl: string,
  body: AnthropicRequest,
  auth: string,
) => {
  reply.raw.writeHead(200, SSE_HEADERS);

  try {
    const stream = streamBackend(`${baseUrl}/v1/messages`, { ...body, stream: true }, auth);
    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Filter and write chunks
    for (const filteredChunk of filterSseEmptyTextBlocks(chunks)) {
      reply.raw.write(filteredChunk);
    }
  } catch (e) {
    reply.raw.write(formatSseError(e));
  }

  reply.raw.end();
  reply.hijack();
};

export default fp(anthropicRoutes, { name: 'anthropic-routes' });

