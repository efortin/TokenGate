/**
 * Backend service for proxying requests to LLM backends.
 */

/** Calls a backend API endpoint and returns the JSON response. */
export async function callBackend<T>(
  url: string,
  body: unknown,
  auth?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (auth) {
    headers['Authorization'] = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend error: ${response.status} ${error}`);
  }

  return (await response.json()) as T;
}

/** Streams a backend API response as chunks. */
export async function* streamBackend(
  url: string,
  body: unknown,
  auth?: string,
): AsyncGenerator<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (auth) {
    headers['Authorization'] = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
  }

  const bodyStr = JSON.stringify(body);
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!response.ok) {
    const error = await response.text();
    // Log detailed error info for debugging
    const reqBody = body as {messages?: unknown[]; model?: string; tools?: unknown[]};
    const msgCount = reqBody.messages?.length ?? 0;
    const lastMsg = reqBody.messages?.[msgCount - 1] as {role?: string; tool_calls?: unknown[]} | undefined;
    console.error(`[streamBackend] Backend error ${response.status}:`, {
      url,
      model: reqBody.model,
      messageCount: msgCount,
      lastMessageRole: lastMsg?.role,
      hasToolCalls: !!lastMsg?.tool_calls,
      toolCount: reqBody.tools?.length,
      errorPreview: error.slice(0, 1000),
    });
    throw new Error(`Backend error: ${response.status} ${error.slice(0, 500)}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      yield decoder.decode(value, {stream: true});
    }
  } finally {
    reader.releaseLock();
  }
}

/** Discovers available models from a backend. */
export async function discoverModels(
  url: string,
  apiKey?: string,
): Promise<string[]> {
  try {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${url}/v1/models`, {headers});
    if (!response.ok) return [];

    const data = (await response.json()) as {data?: {id: string}[]};
    return data.data?.map((m) => m.id) ?? [];
  } catch {
    return [];
  }
}

/** Checks if a backend is healthy. */
export async function checkHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {method: 'GET'});
    return response.ok;
  } catch {
    return false;
  }
}
