import {encoding_for_model} from 'tiktoken';

let tokenEncoder: ReturnType<typeof encoding_for_model> | null = null;

/** Counts tokens in a string using tiktoken (gpt-4 model). */
export function countTokens(text: string): number {
  try {
    if (!tokenEncoder) {
      tokenEncoder = encoding_for_model('gpt-4');
    }
    return tokenEncoder.encode(text).length;
  } catch {
    // Fallback to character-based estimation
    return Math.ceil(text.length / 4);
  }
}

/** Estimates token count for a request by serializing to JSON. */
export function estimateRequestTokens(messages: unknown): number {
  return countTokens(JSON.stringify(messages));
}
