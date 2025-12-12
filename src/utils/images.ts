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
