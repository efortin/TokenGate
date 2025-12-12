// Anthropic API Types

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  stop_sequence?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type: string;
  message?: Partial<AnthropicResponse>;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// Router Config
export interface RouterConfig {
  port: number;
  host: string;
  apiKey: string;
  defaultBackend: BackendConfig;
  visionBackend?: BackendConfig;
  telemetry: TelemetryConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface BackendConfig {
  name: string;
  url: string;
  apiKey: string;
  model: string;
}

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
}

// Token Telemetry
export interface TokenUsage {
  requestId: string;
  timestamp: Date;
  model: string;
  backend: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  hasToolCalls: boolean;
  hasVision: boolean;
}

// OpenAI Types (minimal for proxying)
export interface OpenAIRequest {
  model: string;
  messages: {
    role: string;
    content: string | { type: string; text?: string; image_url?: { url: string } }[];
    tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    tool_call_id?: string;
  }[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  tool_choice?: string | { type: string; function?: { name: string } };
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
