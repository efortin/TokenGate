import {lookup} from 'mime-types';
import type {AnthropicRequest, OpenAIRequest} from '../types/index.js';

/** Checks if an Anthropic request contains images in the last message. */
export function hasAnthropicImages(body: AnthropicRequest): boolean {
  const lastMsg = body.messages[body.messages.length - 1];
  if (!lastMsg || !Array.isArray(lastMsg.content)) return false;
  return lastMsg.content.some((block) => block.type === 'image');
}

/** Checks if an OpenAI request contains images in the last message. */
export function hasOpenAIImages(body: OpenAIRequest): boolean {
  const lastMsg = body.messages[body.messages.length - 1];
  if (!lastMsg || !Array.isArray(lastMsg.content)) return false;
  return lastMsg.content.some((part) => part.type === 'image_url');
}

/** Gets MIME type from file extension. */
export function getMimeType(extension: string): string | false {
  return lookup(extension);
}

/** Checks if a MIME type is an image type. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Strips image blocks from Anthropic messages for non-vision backends. */
export function stripAnthropicImages(body: AnthropicRequest): AnthropicRequest {
  return {
    ...body,
    messages: body.messages.map((msg) => {
      if (typeof msg.content === 'string') return msg;
      const filtered = msg.content.filter((block) => block.type !== 'image');
      // If all content was images, replace with placeholder text
      if (filtered.length === 0) {
        return {...msg, content: '[Image removed]'};
      }
      // If only one text block remains, simplify to string
      if (filtered.length === 1 && filtered[0].type === 'text' && filtered[0].text) {
        return {...msg, content: filtered[0].text};
      }
      return {...msg, content: filtered};
    }),
  };
}

/** Removes tool_choice when tools is empty or missing (vLLM validation fix). */
export function sanitizeToolChoice(body: OpenAIRequest): OpenAIRequest {
  if (body.tool_choice && (!body.tools || (body.tools as unknown[]).length === 0)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {tool_choice, ...rest} = body;
    return rest as OpenAIRequest;
  }
  return body;
}

/** Strips image_url blocks from OpenAI messages for non-vision backends. */
export function stripOpenAIImages(body: OpenAIRequest): OpenAIRequest {
  return {
    ...body,
    messages: body.messages.map((msg) => {
      if (typeof msg.content === 'string' || msg.content === null) return msg;
      if (!Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((part) => part.type !== 'image_url');
      // If all content was images, replace with placeholder text
      if (filtered.length === 0) {
        return {...msg, content: '[Image removed]'};
      }
      // If only one text part remains, simplify to string
      if (filtered.length === 1 && filtered[0].type === 'text' && filtered[0].text) {
        return {...msg, content: filtered[0].text};
      }
      return {...msg, content: filtered};
    }),
  };
}
