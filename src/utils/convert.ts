import type {AnthropicRequest, AnthropicResponse, OpenAIRequest, OpenAIResponse} from '../types/index.js';
import {VISION_SYSTEM_PROMPT} from '../prompts/vision.js';
import {WEB_SEARCH_SYSTEM_PROMPT} from '../prompts/web-search.js';

/**
 * Parsed Mistral tool call from [TOOL_CALLS] format.
 */
interface ParsedMistralToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Parses Mistral's native [TOOL_CALLS] format from text content.
 * Format: [TOOL_CALLS]ToolName{"param": "value", ...}
 * Can have multiple tool calls: [TOOL_CALLS]Tool1{...}[TOOL_CALLS]Tool2{...}
 * @returns Array of parsed tool calls, or null if no [TOOL_CALLS] found
 */
export function parseMistralToolCalls(text: string): ParsedMistralToolCall[] | null {
  if (!text.includes('[TOOL_CALLS]')) {
    return null;
  }

  const toolCalls: ParsedMistralToolCall[] = [];
  // Match [TOOL_CALLS]ToolName followed by JSON object
  // The regex captures: tool name and the JSON object
  const regex = /\[TOOL_CALLS\](\w+)(\{[\s\S]*?\})(?=\[TOOL_CALLS\]|$)/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [, toolName, jsonStr] = match;
    try {
      const args = JSON.parse(jsonStr);
      toolCalls.push({name: toolName, arguments: args});
    } catch {
      // Try to extract partial JSON - might be truncated
      // Skip malformed tool calls
      continue;
    }
  }

  // Also try simpler format: [TOOL_CALLS]ToolName{...} without lookahead
  if (toolCalls.length === 0) {
    const simpleRegex = /\[TOOL_CALLS\](\w+)(\{[^}]+\})/g;
    while ((match = simpleRegex.exec(text)) !== null) {
      const [, toolName, jsonStr] = match;
      try {
        const args = JSON.parse(jsonStr);
        toolCalls.push({name: toolName, arguments: args});
      } catch {
        continue;
      }
    }
  }

  return toolCalls.length > 0 ? toolCalls : null;
}

/**
 * Checks if model name indicates a Mistral model.
 */
export function isMistralModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return lowerModel.includes('mistral') || 
         lowerModel.includes('devstral') || 
         lowerModel.includes('codestral');
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
  /** Add vision system prompt for image analysis. */
  useVisionPrompt?: boolean;
}

/** Converts an Anthropic request to OpenAI format. */
export function anthropicToOpenAI(req: AnthropicRequest, options: ConvertOptions = {}): OpenAIRequest {
  const messages: OpenAIRequest['messages'] = [];

  // Add vision system prompt if requested
  if (options.useVisionPrompt) {
    messages.push({role: 'system', content: VISION_SYSTEM_PROMPT});
  }

  // Add user system message if present
  if (req.system) {
    const systemText = typeof req.system === 'string' 
      ? req.system 
      : req.system.map(s => s.text).join('\n');
    messages.push({role: 'system', content: systemText});
  }

  // Convert messages
  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      messages.push({role: msg.role, content: msg.content});
    } else {
      // Check for tool_use blocks (assistant with tool calls)
      const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');
      if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
        // Convert to OpenAI assistant message with tool_calls
        const textContent = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join('');
        const toolCalls = toolUseBlocks.map((block) => ({
          id: normalizeToolId(block.id || ''),
          type: 'function' as const,
          function: {
            name: block.name || '',
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

      // Check for tool_result blocks (user with tool results)
      const toolResultBlocks = msg.content.filter((b) => b.type === 'tool_result');
      if (msg.role === 'user' && toolResultBlocks.length > 0) {
        // Convert each tool_result to a separate tool message
        // Note: Mistral does NOT allow 'user' after 'tool', so we skip text content here
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

      // Convert other content blocks (text, images)
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

  // Convert Anthropic tools to OpenAI format
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
  // If last message is assistant (without tool_calls), add user message
  // But NOT after 'tool' messages - that's already valid
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
    // Request usage stats in streaming responses
    ...(req.stream && {stream_options: {include_usage: true}}),
    ...(openaiTools && {tools: openaiTools}),
  };
}

/** Normalizes a tool ID to Mistral-compatible format (9 alphanumeric chars). */
export function normalizeToolId(id: string): string {
  // If already valid format, return as-is
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }
  // Generate deterministic ID from original
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({length: 9}, (_, i) => chars[(hash * (i + 1) * 7) % chars.length]).join('');
}

/** Normalizes tool call IDs in OpenAI requests for Mistral compatibility. */
export function normalizeOpenAIToolIds(req: OpenAIRequest): OpenAIRequest {
  const idMap = new Map<string, string>();

  // First pass: collect tool_calls IDs from assistant messages
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

  // Second pass: rewrite all IDs
  const normalizedMessages = req.messages.map((msg) => {
    // Rewrite tool_calls in assistant messages
    const toolCalls = (msg as {tool_calls?: {id: string; type: string; function: unknown}[]}).tool_calls;
    if (msg.role === 'assistant' && toolCalls) {
      const newToolCalls = toolCalls.map((call) => ({
        ...call,
        id: idMap.get(call.id) || call.id,
      }));
      return {...msg, tool_calls: newToolCalls};
    }

    // Rewrite tool_call_id in tool messages
    const toolCallId = (msg as {tool_call_id?: string}).tool_call_id;
    if (msg.role === 'tool' && toolCallId) {
      return {...msg, tool_call_id: idMap.get(toolCallId) || toolCallId};
    }

    return msg;
  });

  // Mistral requires: last message must be 'user' or 'tool', not 'assistant'
  // Only add user message after assistant WITHOUT tool_calls
  const lastMsg = normalizedMessages[normalizedMessages.length - 1];
  const hasToolCalls = lastMsg && (lastMsg as {tool_calls?: unknown[]}).tool_calls;
  if (lastMsg && lastMsg.role === 'assistant' && !hasToolCalls) {
    normalizedMessages.push({role: 'user', content: 'Continue.'});
  }

  return {...req, messages: normalizedMessages};
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

  return {
    ...req,
    system: newSystem,
  };
}

/** Converts an OpenAI response to Anthropic format. */
export function openAIToAnthropic(res: OpenAIResponse, model: string): AnthropicResponse {
  const choice = res.choices[0];
  const content: AnthropicResponse['content'] = [];

  // Add text content if present
  if (choice?.message?.content) {
    content.push({type: 'text', text: choice.message.content});
  }

  // Convert tool_calls to tool_use blocks
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

  // Ensure at least empty text if no content
  if (content.length === 0) {
    content.push({type: 'text', text: ''});
  }

  // Map finish_reason to Anthropic stop_reason
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
 * Generates a Mistral-compatible tool call ID.
 * Mistral requires: a-z, A-Z, 0-9, length of 9.
 */
function generateMistralToolId(index: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // Use index as seed for deterministic IDs, pad with random-looking chars
  const base = index.toString(36).padStart(4, '0');
  const suffix = Array.from({length: 5}, (_, i) => chars[(index * 7 + i * 13) % chars.length]).join('');
  return (base + suffix).slice(0, 9);
}

/**
 * Normalizes tool call IDs in Anthropic requests for Mistral compatibility.
 * Mistral requires tool call IDs to be exactly 9 alphanumeric characters.
 * This function rewrites all tool_use and tool_result IDs to use Mistral-compatible format.
 */
export function normalizeToolCallIds(req: AnthropicRequest): AnthropicRequest {
  // Build a map of original ID -> new Mistral-compatible ID
  const idMap = new Map<string, string>();
  let toolIndex = 0;

  // First pass: collect all tool_use IDs and create mappings
  for (const msg of req.messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.id && !idMap.has(block.id)) {
          // Generate Mistral-compatible ID (9 alphanumeric chars)
          const newId = generateMistralToolId(toolIndex);
          idMap.set(block.id, newId);
          toolIndex++;
        }
      }
    }
  }

  // No tool uses found, nothing to normalize
  if (idMap.size === 0) {
    return req;
  }

  // Second pass: rewrite all IDs
  const normalizedMessages = req.messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return msg;
    }

    const normalizedContent = msg.content.map((block) => {
      // Rewrite tool_use IDs
      if (block.type === 'tool_use' && block.id) {
        const newId = idMap.get(block.id);
        if (newId) {
          return {...block, id: newId};
        }
      }
      // Rewrite tool_result IDs
      if (block.type === 'tool_result' && block.tool_use_id) {
        const newId = idMap.get(block.tool_use_id);
        if (newId) {
          return {...block, tool_use_id: newId};
        }
      }
      return block;
    });

    return {...msg, content: normalizedContent};
  });

  return {...req, messages: normalizedMessages};
}

/**
 * Converts OpenAI SSE stream chunks to Anthropic SSE format.
 * This is a generator that yields Anthropic-formatted SSE events.
 * @param stream - The OpenAI SSE stream
 * @param model - The model name
 * @param estimatedInputTokens - Pre-calculated input token estimate (from tiktoken)
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
  
  // Buffer for Mistral [TOOL_CALLS] detection
  let textBuffer = '';
  let mistralToolCallsDetected = false;
  const checkMistral = isMistralModel(model);

  // Send message_start event with estimated input tokens
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
    // Parse SSE data lines
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

      // Track usage if provided (may come in final chunk with empty choices)
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || inputTokens;
        outputTokens = chunk.usage.completion_tokens || outputTokens;
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        // Final usage-only chunk - skip, we already sent estimated input_tokens in message_start
        continue;
      }

      const delta = choice.delta;

      // Handle text content
      if (delta.content) {
        // For Mistral models, buffer content to detect [TOOL_CALLS]
        if (checkMistral) {
          textBuffer += delta.content;
          
          // Check if we're starting to see [TOOL_CALLS]
          if (textBuffer.includes('[TOOL_CALLS]')) {
            mistralToolCallsDetected = true;
            // Don't emit text - we'll process tool calls at the end
            outputTokens++;
            continue;
          }
          
          // If we haven't seen [TOOL_CALLS] yet and buffer is getting long,
          // emit the safe portion (keeping last 20 chars for partial detection)
          if (!mistralToolCallsDetected && textBuffer.length > 20) {
            const safeText = textBuffer.slice(0, -20);
            textBuffer = textBuffer.slice(-20);
            
            if (safeText) {
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
                delta: {type: 'text_delta', text: safeText},
              })}\n\n`;
            }
          }
        } else {
          // Non-Mistral: emit directly
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
        }
        outputTokens++;
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            // New tool call
            toolCalls.set(tc.index, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
            // Close previous text block if needed
            if (!isFirstContent) {
              yield `event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: contentIndex,
              })}\n\n`;
              contentIndex++;
            }
            isFirstContent = false;
            yield `event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: contentIndex + tc.index,
              content_block: {
                type: 'tool_use',
                id: tc.id || `tool_${tc.index}`,
                name: tc.function?.name || '',
                input: {},
              },
            })}\n\n`;
          } else {
            // Append to existing tool call
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

      // Handle finish
      if (choice.finish_reason) {
        let stopReason = 'end_turn';
        
        // For Mistral: check if we have buffered [TOOL_CALLS] to process
        if (checkMistral && mistralToolCallsDetected && textBuffer) {
          const parsedTools = parseMistralToolCalls(textBuffer);
          if (parsedTools && parsedTools.length > 0) {
            // Close any open text block first
            if (!isFirstContent) {
              yield `event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: contentIndex,
              })}\n\n`;
              contentIndex++;
            }
            
            // Emit tool_use blocks for each parsed tool call
            for (let i = 0; i < parsedTools.length; i++) {
              const tool = parsedTools[i];
              const toolId = generateMistralToolId(i);
              
              // content_block_start for tool_use
              yield `event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: contentIndex + i,
                content_block: {
                  type: 'tool_use',
                  id: toolId,
                  name: tool.name,
                  input: tool.arguments,
                },
              })}\n\n`;
              
              // content_block_stop for tool_use
              yield `event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: contentIndex + i,
              })}\n\n`;
            }
            
            stopReason = 'tool_use';
            isFirstContent = true; // Already closed
          }
        } else if (checkMistral && textBuffer && !mistralToolCallsDetected) {
          // Emit any remaining buffered text
          if (textBuffer) {
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
              delta: {type: 'text_delta', text: textBuffer},
            })}\n\n`;
          }
        }
        
        // Close any open content blocks
        if (!isFirstContent) {
          yield `event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: contentIndex,
          })}\n\n`;
        }

        // Map finish reason (if not already set by tool parsing)
        if (stopReason === 'end_turn') {
          if (choice.finish_reason === 'tool_calls') {
            stopReason = 'tool_use';
          } else if (choice.finish_reason === 'length') {
            stopReason = 'max_tokens';
          }
        }

        // Send message_delta with usage
        yield `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: {stop_reason: stopReason, stop_sequence: null},
          usage: {output_tokens: outputTokens},
        })}\n\n`;

        // Send message_stop
        yield `event: message_stop\ndata: ${JSON.stringify({type: 'message_stop'})}\n\n`;
      }
    }
  }
}
