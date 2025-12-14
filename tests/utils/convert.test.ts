import {describe, it, expect} from 'vitest';
import {anthropicToOpenAI, openAIToAnthropic, injectWebSearchPrompt, normalizeOpenAIToolIds, parseMistralToolCalls, isMistralModel} from '../../src/utils/convert.js';
import type {AnthropicRequest, OpenAIResponse, OpenAIRequest} from '../../src/types/index.js';

describe('anthropicToOpenAI', () => {
  it('should convert simple text message', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{role: 'user', content: 'Hello'}],
    };

    const result = anthropicToOpenAI(req);

    expect(result.model).toBe('claude-3');
    expect(result.max_tokens).toBe(1024);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({role: 'user', content: 'Hello'});
  });

  it('should convert string system message', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      system: 'You are helpful',
      messages: [{role: 'user', content: 'Hi'}],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages[0]).toEqual({role: 'system', content: 'You are helpful'});
    expect(result.messages[1]).toEqual({role: 'user', content: 'Hi'});
  });

  it('should convert array system message', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      system: [{type: 'text', text: 'Part 1'}, {type: 'text', text: 'Part 2'}],
      messages: [{role: 'user', content: 'Hi'}],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages[0]).toEqual({role: 'system', content: 'Part 1\nPart 2'});
  });

  it('should convert text content blocks', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{type: 'text', text: 'Hello world'}],
      }],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages[0].content).toEqual([{type: 'text', text: 'Hello world'}]);
  });

  it('should convert image content blocks', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: {type: 'base64', media_type: 'image/png', data: 'abc123'},
        }],
      }],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages[0].content).toEqual([{
      type: 'image_url',
      image_url: {url: 'data:image/png;base64,abc123'},
    }]);
  });

  it('should handle mixed content blocks', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {type: 'text', text: 'What is this?'},
          {type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: 'xyz'}},
        ],
      }],
    };

    const result = anthropicToOpenAI(req);
    const content = result.messages[0].content as {type: string}[];

    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({type: 'text', text: 'What is this?'});
    expect(content[1]).toEqual({type: 'image_url', image_url: {url: 'data:image/jpeg;base64,xyz'}});
  });

  it('should add vision prompt when useVisionPrompt is true', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{role: 'user', content: 'Hi'}],
    };

    const result = anthropicToOpenAI(req, {useVisionPrompt: true});

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('vision assistant');
  });

  it('should handle unknown content block types', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        // @ts-expect-error testing unknown block type
        content: [{type: 'unknown', data: 'test'}],
      }],
    };

    const result = anthropicToOpenAI(req);
    const content = result.messages[0].content as {type: string; text: string}[];

    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('unknown');
  });

  it('should preserve stream flag', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      stream: true,
      messages: [{role: 'user', content: 'Hi'}],
    };

    const result = anthropicToOpenAI(req);

    expect(result.stream).toBe(true);
  });

  it('should convert tool_use blocks to OpenAI tool_calls', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'List files'},
        {role: 'assistant', content: [{
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'bash',
          input: {command: 'ls'},
        }]},
      ],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].role).toBe('assistant');
    const toolCalls = (result.messages[1] as {tool_calls?: unknown[]}).tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls as {id: string; function: {name: string}}[])[0].function.name).toBe('bash');
  });

  it('should convert tool_result blocks to OpenAI tool messages', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'List files'},
        {role: 'assistant', content: [{
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'bash',
          input: {command: 'ls'},
        }]},
        {role: 'user', content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_abc123',
          content: 'file1.txt\nfile2.txt',
        }]},
      ],
    };

    const result = anthropicToOpenAI(req);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].role).toBe('tool');
  });

  it('should NOT add user message after tool message (Mistral constraint)', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'List files'},
        {role: 'assistant', content: [{
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'bash',
          input: {command: 'ls'},
        }]},
        {role: 'user', content: [
          {type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'file1.txt'},
          {type: 'text', text: 'Now analyze this'},
        ]},
      ],
    };

    const result = anthropicToOpenAI(req);

    // Should have: user, assistant (tool_calls), tool
    // Should NOT have a 'user' message after 'tool' (Mistral rejects this)
    const roles = result.messages.map(m => m.role);
    
    // Find the index of 'tool' message
    const toolIndex = roles.indexOf('tool');
    expect(toolIndex).toBeGreaterThan(-1);
    
    // No 'user' should come after 'tool'
    const afterTool = roles.slice(toolIndex + 1);
    expect(afterTool.includes('user')).toBe(false);
  });

  it('should convert Anthropic tools to OpenAI format', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{role: 'user', content: 'Hi'}],
      tools: [{
        name: 'calculator',
        description: 'Perform math',
        input_schema: {type: 'object', properties: {expr: {type: 'string'}}},
      }],
    };

    const result = anthropicToOpenAI(req);

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].type).toBe('function');
    expect(result.tools![0].function.name).toBe('calculator');
  });
});

describe('openAIToAnthropic', () => {
  it('should convert basic response', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {role: 'assistant', content: 'Hello there!'},
        finish_reason: 'stop',
      }],
      usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
    };

    const result = openAIToAnthropic(res, 'test-model');

    expect(result.id).toBe('chatcmpl-123');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('test-model');
    expect(result.content).toEqual([{type: 'text', text: 'Hello there!'}]);
    expect(result.stop_reason).toBe('end_turn');
    expect(result.usage).toEqual({input_tokens: 10, output_tokens: 5});
  });

  it('should handle non-stop finish reason', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {role: 'assistant', content: 'Hello'},
        finish_reason: 'length',
      }],
    };

    const result = openAIToAnthropic(res, 'test-model');

    expect(result.stop_reason).toBe('length');
  });

  it('should handle missing usage', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {role: 'assistant', content: 'Hello'},
        finish_reason: 'stop',
      }],
    };

    const result = openAIToAnthropic(res, 'test-model');

    expect(result.usage).toEqual({input_tokens: 0, output_tokens: 0});
  });

  it('should handle empty choices', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [],
    };

    const result = openAIToAnthropic(res, 'test-model');

    expect(result.content).toEqual([{type: 'text', text: ''}]);
    expect(result.stop_reason).toBeNull();
  });
});

describe('injectWebSearchPrompt', () => {
  it('should inject prompt when no system exists', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [{role: 'user', content: 'Hello'}],
    };

    const result = injectWebSearchPrompt(req);

    expect(result.system).toContain('Web Search Guidelines');
    expect(result.messages).toEqual(req.messages);
  });

  it('should append prompt to string system', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      system: 'You are helpful',
      messages: [{role: 'user', content: 'Hello'}],
    };

    const result = injectWebSearchPrompt(req);

    expect(result.system).toContain('You are helpful');
    expect(result.system).toContain('Web Search Guidelines');
  });

  it('should append prompt to array system', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      system: [{type: 'text', text: 'Part 1'}, {type: 'text', text: 'Part 2'}],
      messages: [{role: 'user', content: 'Hello'}],
    };

    const result = injectWebSearchPrompt(req);

    expect(result.system).toContain('Part 1');
    expect(result.system).toContain('Part 2');
    expect(result.system).toContain('Web Search Guidelines');
  });

  it('should handle array system with empty text', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      system: [{type: 'text', text: ''}, {type: 'text', text: 'Valid'}],
      messages: [{role: 'user', content: 'Hello'}],
    };

    const result = injectWebSearchPrompt(req);

    expect(result.system).toContain('Valid');
    expect(result.system).toContain('Web Search Guidelines');
  });
});

describe('isMistralModel', () => {
  it('should detect mistral models', () => {
    expect(isMistralModel('mistral-7b')).toBe(true);
    expect(isMistralModel('Mistral-Large')).toBe(true);
    expect(isMistralModel('mistralai/Mistral-7B')).toBe(true);
  });

  it('should detect devstral models', () => {
    expect(isMistralModel('devstral-small-2-24b')).toBe(true);
    expect(isMistralModel('Devstral-Small-2-24B-Instruct')).toBe(true);
  });

  it('should detect codestral models', () => {
    expect(isMistralModel('codestral-latest')).toBe(true);
    expect(isMistralModel('Codestral-22B')).toBe(true);
  });

  it('should not detect non-mistral models', () => {
    expect(isMistralModel('claude-3')).toBe(false);
    expect(isMistralModel('gpt-4')).toBe(false);
    expect(isMistralModel('llama-3')).toBe(false);
  });
});

describe('parseMistralToolCalls', () => {
  it('should return null for text without [TOOL_CALLS]', () => {
    expect(parseMistralToolCalls('Hello world')).toBeNull();
    expect(parseMistralToolCalls('Some text without tool calls')).toBeNull();
  });

  it('should parse single tool call', () => {
    const text = '[TOOL_CALLS]Write{"file_path": "/test.txt", "content": "hello"}';
    const result = parseMistralToolCalls(text);
    
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('Write');
    expect(result![0].arguments).toEqual({file_path: '/test.txt', content: 'hello'});
  });

  it('should parse tool call with complex JSON', () => {
    const text = '[TOOL_CALLS]Read{"file_path": "/Users/test/file.md", "offset": 0, "limit": 100}';
    const result = parseMistralToolCalls(text);
    
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('Read');
    expect(result![0].arguments).toEqual({file_path: '/Users/test/file.md', offset: 0, limit: 100});
  });

  it('should parse multiple tool calls', () => {
    const text = '[TOOL_CALLS]Read{"path": "/a.txt"}[TOOL_CALLS]Write{"path": "/b.txt", "content": "test"}';
    const result = parseMistralToolCalls(text);
    
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].name).toBe('Read');
    expect(result![1].name).toBe('Write');
  });

  it('should handle text before [TOOL_CALLS]', () => {
    const text = 'I will now write the file. [TOOL_CALLS]Write{"file_path": "/test.txt", "content": "data"}';
    const result = parseMistralToolCalls(text);
    
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('Write');
  });

  it('should skip malformed JSON', () => {
    const text = '[TOOL_CALLS]Bad{not valid json}';
    const result = parseMistralToolCalls(text);
    
    expect(result).toBeNull();
  });

  it('should parse valid calls and skip invalid ones', () => {
    const text = '[TOOL_CALLS]Good{"key": "value"}[TOOL_CALLS]Bad{invalid}';
    const result = parseMistralToolCalls(text);
    
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('Good');
  });
});
