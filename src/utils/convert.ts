import type {AnthropicRequest, AnthropicResponse, OpenAIRequest, OpenAIResponse} from '../types/index.js';
import {VISION_SYSTEM_PROMPT} from '../prompts/vision.js';
import {WEB_SEARCH_SYSTEM_PROMPT} from '../prompts/web-search.js';

/**
 * Sanitizes a tool/function name to be valid for OpenAI/Mistral API.
 * Must be a-z, A-Z, 0-9, underscores and dashes, max 64 chars.
 */
export function sanitizeToolName(name: string): string {
  let sanitized = name.trim();
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_');
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  if (sanitized.length > 64) {
    sanitized = sanitized.slice(0, 64);
  }
  return sanitized || 'unknown_tool';
}

/** OpenAI stream chunk structure */
interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: string;
        function?: {name?: string; arguments?: string};
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ConvertOptions {
  useVisionPrompt?: boolean;
}

/** Normalizes a tool ID to Mistral-compatible format (9 alphanumeric chars). */
export function normalizeToolId(id: string): string {
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({length: 9}, (_, i) => chars[(hash * (i + 1) * 7) % chars.length]).join('');
}

/** Converts an Anthropic request to OpenAI format. */
export function anthropicToOpenAI(req: AnthropicRequest, options: ConvertOptions = {}): OpenAIRequest {
  const messages: OpenAIRequest['messages'] = [];

  if (options.useVisionPrompt) {
    messages.push({role: 'system', content: VISION_SYSTEM_PROMPT});
  }

  if (req.system) {
    const systemText = typeof req.system === 'string' 
      ? req.system 
      : req.system.map(s => s.text).join('\n');
    messages.push({role: 'system', content: systemText});
  }

  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      messages.push({role: msg.role, content: msg.content});
    } else {
      const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');
      if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
        const textContent = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join('');
        const toolCalls = toolUseBlocks.map((block) => ({
          id: normalizeToolId(block.id || ''),
          type: 'function' as const,
          function: {
            name: sanitizeToolName(block.name || ''),
            arguments: JSON.stringify(block.input || {}),
          },
        }));
        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls,
        });
        continue;
      }

      const toolResultBlocks = msg.content.filter((b) => b.type === 'tool_result');
      if (msg.role === 'user' && toolResultBlocks.length > 0) {
        for (const block of toolResultBlocks) {
          const resultContent = typeof block.content === 'string' 
            ? block.content 
            : JSON.stringify(block.content);
          messages.push({
            role: 'tool',
            tool_call_id: normalizeToolId(block.tool_use_id || ''),
            content: resultContent,
          });
        }
        continue;
      }

      const parts = msg.content.map((block) => {
        if (block.type === 'text') {
          return {type: 'text', text: block.text || ''};
        }
        if (block.type === 'image') {
          const source = block.source as {type: string; media_type: string; data: string};
          return {
            type: 'image_url',
            image_url: {url: `data:${source.media_type};base64,${source.data}`},
          };
        }
        return {type: 'text', text: JSON.stringify(block)};
      });
      messages.push({role: msg.role, content: parts});
    }
  }

  const tools = req.tools as {name: string; description: string; input_schema: unknown}[] | undefined;
  const openaiTools = tools?.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));

  // Mistral requires: last message must be 'user' or 'tool', not 'assistant'
  const lastMsg = messages[messages.length - 1];
  const hasToolCalls = lastMsg && (lastMsg as {tool_calls?: unknown[]}).tool_calls;
  if (lastMsg && lastMsg.role === 'assistant' && !hasToolCalls) {
    messages.push({role: 'user', content: 'Continue.'});
  }

  return {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream,
    ...(req.stream && {stream_options: {include_usage: true}}),
    ...(openaiTools && {tools: openaiTools}),
  };
}

/**
 * Normalizes tool call IDs in OpenAI requests for Mistral/vLLM compatibility.
 * - Strips `index` field (mistral-common rejects it)
 * - Sanitizes malformed JSON in arguments
 * - Normalizes IDs to 9 alphanumeric chars
 */
export function normalizeOpenAIToolIds(req: OpenAIRequest): OpenAIRequest {
  const idMap = new Map<string, string>();

  for (const msg of req.messages) {
    const toolCalls = (msg as {tool_calls?: {id: string}[]}).tool_calls;
    if (msg.role === 'assistant' && toolCalls) {
      for (const call of toolCalls) {
        if (call.id && !idMap.has(call.id)) {
          idMap.set(call.id, normalizeToolId(call.id));
        }
      }
    }
  }

  const normalizedMessages = req.messages.map((msg) => {
    const toolCalls = (msg as {tool_calls?: {id: string; type: string; function: {name: string; arguments: string}; index?: number}[]}).tool_calls;
    if (msg.role === 'assistant' && toolCalls) {
      const newToolCalls = toolCalls.map((call) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const {index, ...rest} = call;
        let sanitizedArgs = rest.function?.arguments || '{}';
        try {
          JSON.parse(sanitizedArgs);
        } catch {
          sanitizedArgs = '{}';
        }
        return {
          ...rest,
          id: idMap.get(rest.id) || rest.id,
          function: {...rest.function, arguments: sanitizedArgs},
        };
      });
      return {...msg, tool_calls: newToolCalls};
    }

    const toolCallId = (msg as {tool_call_id?: string}).tool_call_id;
    if (msg.role === 'tool' && toolCallId) {
      return {...msg, tool_call_id: idMap.get(toolCallId) || toolCallId};
    }

    return msg;
  });

  return {...req, messages: normalizedMessages};
}

/** Filters out invalid assistant messages (empty content and no tool_calls). */
export function filterEmptyAssistantMessages(req: OpenAIRequest): OpenAIRequest {
  const filteredMessages = req.messages.filter((msg) => {
    if (msg.role === 'assistant') {
      const content = (msg as {content?: string | null}).content;
      const toolCalls = (msg as {tool_calls?: unknown[]}).tool_calls;
      if ((!content || content === '') && (!toolCalls || toolCalls.length === 0)) {
        return false;
      }
    }
    return true;
  });
  return {...req, messages: filteredMessages};
}

/** Injects web search system prompt into an Anthropic request. */
export function injectWebSearchPrompt(req: AnthropicRequest): AnthropicRequest {
  let existingSystem = '';

  if (typeof req.system === 'string') {
    existingSystem = req.system;
  } else if (Array.isArray(req.system)) {
    existingSystem = req.system.map((block) => block.text || '').join('\n\n');
  }

  const newSystem = existingSystem
    ? `${existingSystem}\n\n${WEB_SEARCH_SYSTEM_PROMPT}`
    : WEB_SEARCH_SYSTEM_PROMPT;

  return {...req, system: newSystem};
}

/** Converts an OpenAI response to Anthropic format. */
export function openAIToAnthropic(res: OpenAIResponse, model: string): AnthropicResponse {
  const choice = res.choices[0];
  const content: AnthropicResponse['content'] = [];

  if (choice?.message?.content) {
    content.push({type: 'text', text: choice.message.content});
  }

  const toolCalls = (choice?.message as {tool_calls?: {id: string; function: {name: string; arguments: string}}[]})?.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const call of toolCalls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        input = {raw: call.function.arguments};
      }
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input,
      });
    }
  }

  if (content.length === 0) {
    content.push({type: 'text', text: ''});
  }

  let stopReason: string | null = null;
  if (choice?.finish_reason === 'stop') {
    stopReason = 'end_turn';
  } else if (choice?.finish_reason === 'tool_calls') {
    stopReason = 'tool_use';
  } else if (choice?.finish_reason) {
    stopReason = choice.finish_reason;
  }

  return {
    id: res.id,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    usage: {
      input_tokens: res.usage?.prompt_tokens || 0,
      output_tokens: res.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Converts OpenAI SSE stream to Anthropic SSE format.
 * Simple pass-through conversion without Mistral [TOOL_CALLS] buffering.
 */
export async function* convertOpenAIStreamToAnthropic(
  stream: AsyncGenerator<string>,
  model: string,
  estimatedInputTokens = 0,
): AsyncGenerator<string> {
  const messageId = `msg_${Date.now()}`;
  let inputTokens = estimatedInputTokens;
  let outputTokens = 0;
  let contentIndex = 0;
  let isFirstContent = true;
  const toolCalls = new Map<number, {id: string; name: string; arguments: string}>();
  let finalStopReason: string | null = null;
  let messageStopped = false;

  yield `event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {input_tokens: estimatedInputTokens, output_tokens: 0},
    },
  })}\n\n`;

  for await (const rawChunk of stream) {
    const lines = rawChunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || inputTokens;
        if (chunk.usage.completion_tokens) {
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        if (chunk.usage && finalStopReason && !messageStopped) {
          yield `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: {stop_reason: finalStopReason, stop_sequence: null},
            usage: {input_tokens: chunk.usage.prompt_tokens || inputTokens, output_tokens: chunk.usage.completion_tokens || outputTokens},
          })}\n\n`;
          yield `event: message_stop\ndata: ${JSON.stringify({type: 'message_stop'})}\n\n`;
          messageStopped = true;
        }
        continue;
      }

      const delta = choice.delta;

      if (delta.content) {
        if (isFirstContent) {
          yield `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: contentIndex,
            content_block: {type: 'text', text: ''},
          })}\n\n`;
          isFirstContent = false;
        }
        yield `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: contentIndex,
          delta: {type: 'text_delta', text: delta.content},
        })}\n\n`;
        outputTokens++;
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
            if (!isFirstContent) {
              yield `event: content_block_stop\ndata: ${JSON.stringify({type: 'content_block_stop', index: contentIndex})}\n\n`;
              contentIndex++;
            }
            isFirstContent = false;
            yield `event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: contentIndex + tc.index,
              content_block: {type: 'tool_use', id: tc.id || `tool_${tc.index}`, name: tc.function?.name || '', input: {}},
            })}\n\n`;
          } else {
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
              yield `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: contentIndex + tc.index,
                delta: {type: 'input_json_delta', partial_json: tc.function.arguments},
              })}\n\n`;
            }
          }
        }
      }

      if (choice.finish_reason) {
        if (!isFirstContent) {
          yield `event: content_block_stop\ndata: ${JSON.stringify({type: 'content_block_stop', index: contentIndex})}\n\n`;
        }

        let stopReason = 'end_turn';
        if (choice.finish_reason === 'tool_calls') {
          stopReason = 'tool_use';
        } else if (choice.finish_reason === 'length') {
          stopReason = 'max_tokens';
        }
        finalStopReason = stopReason;
      }
    }
  }
}
