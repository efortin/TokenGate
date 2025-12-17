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
  system?: string | { type: string; text: string }[];
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
  image_url?: { url: string };
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
    message: { role: string; content: string | null };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

import { z } from 'zod';

// =============================================================================
// Config Schemas (Zod) - Runtime validated
// =============================================================================

/** Backend configuration schema. */
export const BackendConfigSchema = z.object({
  name: z.string().default('vllm'),
  url: z.string().default('http://localhost:8000'),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  /** Optional temperature override (0.0-2.0). If set, overrides client temperature. */
  temperature: z.coerce.number().min(0).max(2).optional(),
});

/** Router configuration schema (loaded from environment). */
export const RouterConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3456),
  host: z.string().default('0.0.0.0'),
  apiKey: z.string().default(''),
  defaultBackend: BackendConfigSchema,
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  logPretty: z.coerce.boolean().default(false),
  logFilePath: z.string().optional(),
});

/** Application configuration schema (runtime subset). */
export const AppConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  host: z.string(),
  apiKey: z.string(),
  defaultBackend: BackendConfigSchema,
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

// Inferred types from schemas
export type BackendConfig = z.infer<typeof BackendConfigSchema>;
export type RouterConfig = z.infer<typeof RouterConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
