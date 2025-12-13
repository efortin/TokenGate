import type {AnthropicRequest, AnthropicResponse, OpenAIRequest, OpenAIResponse} from '../types/index.js';
import {VISION_SYSTEM_PROMPT} from '../prompts/vision.js';
import {WEB_SEARCH_SYSTEM_PROMPT} from '../prompts/web-search.js';

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
      // Convert content blocks
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

  return {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream,
  };
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
  return {
    id: res.id,
    type: 'message',
    role: 'assistant',
    content: [{type: 'text', text: choice?.message?.content || ''}],
    model,
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : choice?.finish_reason || null,
    usage: {
      input_tokens: res.usage?.prompt_tokens || 0,
      output_tokens: res.usage?.completion_tokens || 0,
    },
  };
}
