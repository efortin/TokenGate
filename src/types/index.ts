/** Anthropic message content block. */
export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** Anthropic message. */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Anthropic API request. */
export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | {type: string; text: string}[];
  stream?: boolean;
  [key: string]: unknown;
}

/** Anthropic API response. */
export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** OpenAI message content. */
export interface OpenAIMessageContent {
  type: string;
  text?: string;
  image_url?: {url: string};
  [key: string]: unknown;
}

/** OpenAI message. */
export interface OpenAIMessage {
  role: string;
  content: string | OpenAIMessageContent[] | null;
  [key: string]: unknown;
}

/** OpenAI API request. */
export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

/** OpenAI API response. */
export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {role: string; content: string | null};
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Backend configuration. */
export interface BackendConfig {
  name: string;
  url: string;
  apiKey: string;
  model: string;
}

/** Router configuration loaded from environment. */
export interface RouterConfig {
  port: number;
  host: string;
  apiKey: string;
  defaultBackend: BackendConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/** Application configuration used at runtime. */
export interface AppConfig {
  port: number;
  host: string;
  apiKey: string;
  defaultBackend: BackendConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
