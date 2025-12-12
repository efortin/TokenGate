import {StatusCodes, ReasonPhrases} from 'http-status-codes';

/** SSE headers for streaming responses. */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

/** Common HTTP status codes re-exported for convenience. */
export {StatusCodes, ReasonPhrases};

/** Creates an API error response object. */
export function createApiError(message: string, type = 'api_error') {
  return {
    error: {
      type,
      message,
    },
  };
}

/** Formats an error as an SSE event string. */
export function formatSseError(error: unknown, type = 'error'): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return `data: ${JSON.stringify({type, error: {type: 'api_error', message}})}\n\n`;
}
