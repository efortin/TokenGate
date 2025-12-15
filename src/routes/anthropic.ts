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
      const response = await callBackend<AnthropicResponse>(`${baseUrl}/v1/messages`, payload, auth);

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
// Streaming - SSE with message_start enrichment
// ============================================================================

/**
 * Enriches SSE chunks to fix missing Anthropic fields in vLLM responses.
 * vLLM message_start is missing: type, role, stop_reason, stop_sequence
 * which Claude Code needs for proper token counting.
 * 
 * Also injects calculated input_tokens from the request to ensure 
 * Claude Code displays correct token counts even with parallel requests.
 * 
 * Filters out empty text content blocks to prevent "(no content)" display.
 * 
 * IMPORTANT: Handles event: + data: line pairs correctly - when filtering
 * a data: line, also skips the preceding event: line.
 */
function enrichSseChunk(
  chunk: string,
  calculatedInputTokens: number | undefined,
  emptyBlockIndices: Set<number>,
): string {
  const lines = chunk.split('\n');
  const outputLines: string[] = [];
  let pendingEventLine: string | null = null;

  for (const line of lines) {
    // Track event: lines - they must be paired with their data: line
    if (line.startsWith('event: ')) {
      pendingEventLine = line;
      continue;
    }

    // Handle non-data lines (empty lines, etc)
    if (!line.startsWith('data: ')) {
      // Output any pending event line first
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

      // Enrich message_start with missing Anthropic fields and calculated tokens
      if (data.type === 'message_start' && data.message) {
        data.message = {
          ...data.message,
          type: data.message.type || 'message',
          role: data.message.role || 'assistant',
          stop_reason: data.message.stop_reason ?? null,
          stop_sequence: data.message.stop_sequence ?? null,
        };
        // Override input_tokens with our calculated value for accurate display
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

      // Also update message_delta usage if we have calculated tokens
      if (data.type === 'message_delta' && data.usage && calculatedInputTokens !== undefined) {
        data.usage.input_tokens = calculatedInputTokens;
        if (pendingEventLine) {
          outputLines.push(pendingEventLine);
          pendingEventLine = null;
        }
        outputLines.push(`data: ${JSON.stringify(data)}`);
        continue;
      }

      // Track and filter empty text blocks (causes "(no content)" display)
      if (data.type === 'content_block_start' && data.content_block?.type === 'text') {
        if (data.content_block.text === '') {
          emptyBlockIndices.add(data.index);
          // Skip both event: and data: lines
          pendingEventLine = null;
          continue;
        }
      }

      // Skip events for tracked empty text blocks
      if (data.index !== undefined && emptyBlockIndices.has(data.index)) {
        if (data.type === 'content_block_delta' || data.type === 'content_block_stop') {
          // Skip both event: and data: lines
          pendingEventLine = null;
          continue;
        }
      }

      // Keep this event - output both event: and data: lines
      if (pendingEventLine) {
        outputLines.push(pendingEventLine);
        pendingEventLine = null;
      }
      outputLines.push(line);
    } catch {
      // Not valid JSON, pass through both lines
      if (pendingEventLine) {
        outputLines.push(pendingEventLine);
        pendingEventLine = null;
      }
      outputLines.push(line);
    }
  }

  // Output any remaining pending event line
  if (pendingEventLine) {
    outputLines.push(pendingEventLine);
  }

  return outputLines.join('\n');
}

const streamAnthropic = async (
  reply: FastifyReply,
  baseUrl: string,
  body: AnthropicRequest,
  auth: string,
) => {
  reply.raw.writeHead(200, SSE_HEADERS);

  // Calculate input tokens from the request for accurate display
  const calculatedInputTokens = calculateTokenCount(
    body.messages as Parameters<typeof calculateTokenCount>[0],
    body.system as Parameters<typeof calculateTokenCount>[1],
    (body as { tools?: unknown[] }).tools as Parameters<typeof calculateTokenCount>[2],
  );

  // Track empty text block indices to filter across chunks
  const emptyBlockIndices = new Set<number>();

  try {
    const stream = streamBackend(`${baseUrl}/v1/messages`, { ...body, stream: true }, auth);
    for await (const chunk of stream) {
      const enriched = enrichSseChunk(chunk, calculatedInputTokens, emptyBlockIndices);
      if (enriched.trim()) {
        reply.raw.write(enriched);
      }
    }
  } catch (e) {
    reply.raw.write(formatSseError(e));
  }

  reply.raw.end();
  reply.hijack();
};

export default fp(anthropicRoutes, { name: 'anthropic-routes' });
