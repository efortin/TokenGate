import { z } from 'zod';

// =============================================================================
// OpenAI Types (Zod Schemas)
// =============================================================================

/** OpenAI message content schema. */
export const OpenAIMessageContentSchema = z.object({
    type: z.string(),
    text: z.string().optional(),
    image_url: z.object({ url: z.string() }).optional(),
}).passthrough();

/** OpenAI message schema. */
export const OpenAIMessageSchema = z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(OpenAIMessageContentSchema), z.null()]),
}).passthrough();

/** OpenAI API request schema. */
export const OpenAIRequestSchema = z.object({
    model: z.string(),
    messages: z.array(OpenAIMessageSchema),
    stream: z.boolean().optional(),
}).passthrough();

/** OpenAI API response choice schema. */
export const OpenAIChoiceSchema = z.object({
    index: z.number(),
    message: z.object({
        role: z.string(),
        content: z.string().nullable(),
    }),
    finish_reason: z.string(),
});

/** OpenAI API response usage schema. */
export const OpenAIUsageSchema = z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
});

/** OpenAI API response schema. */
export const OpenAIResponseSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(OpenAIChoiceSchema),
    usage: OpenAIUsageSchema.optional(),
});

// Inferred types from schemas
export type OpenAIMessageContent = z.infer<typeof OpenAIMessageContentSchema>;
export type OpenAIMessage = z.infer<typeof OpenAIMessageSchema>;
export type OpenAIRequest = z.infer<typeof OpenAIRequestSchema>;
export type OpenAIResponse = z.infer<typeof OpenAIResponseSchema>;
