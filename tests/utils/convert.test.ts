import {describe, it, expect} from 'vitest';
import {anthropicToOpenAI, openAIToAnthropic, injectWebSearchPrompt, sanitizeToolName, normalizeOpenAIToolIds, filterEmptyAssistantMessages, convertOpenAIStreamToAnthropic} from '../../src/utils/convert.js';
import type {AnthropicRequest, OpenAIResponse} from '../../src/types/index.js';

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
    const tools = result.tools as {type: string; function: {name: string}}[];

    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('calculator');
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

describe('sanitizeToolName', () => {
  it('should trim leading/trailing spaces', () => {
    expect(sanitizeToolName(' Glob')).toBe('Glob');
    expect(sanitizeToolName('Glob ')).toBe('Glob');
    expect(sanitizeToolName('  Read  ')).toBe('Read');
  });

  it('should replace invalid characters with underscore', () => {
    expect(sanitizeToolName('my tool')).toBe('my_tool');
    expect(sanitizeToolName('tool.name')).toBe('tool_name');
    expect(sanitizeToolName('tool:name')).toBe('tool_name');
  });

  it('should allow valid characters', () => {
    expect(sanitizeToolName('my_tool')).toBe('my_tool');
    expect(sanitizeToolName('my-tool')).toBe('my-tool');
    expect(sanitizeToolName('MyTool123')).toBe('MyTool123');
  });

  it('should truncate to 64 chars', () => {
    const longName = 'a'.repeat(100);
    expect(sanitizeToolName(longName).length).toBe(64);
  });

  it('should handle empty string', () => {
    expect(sanitizeToolName('')).toBe('unknown_tool');
    expect(sanitizeToolName('   ')).toBe('unknown_tool');
  });

  it('should handle the specific " Glob" case from the error', () => {
    expect(sanitizeToolName(' Glob')).toBe('Glob');
  });

  it('should handle multiple consecutive invalid chars', () => {
    expect(sanitizeToolName('tool...name')).toBe('tool___name');
    expect(sanitizeToolName('tool   name')).toBe('tool___name');
  });

  it('should handle unicode characters', () => {
    expect(sanitizeToolName('工具')).toBe('unknown_tool');
    expect(sanitizeToolName('tool_日本語')).toBe('tool');
  });
});

describe('anthropicToOpenAI edge cases', () => {
  it('should sanitize tool names with spaces in tool_use blocks', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'Test'},
        {role: 'assistant', content: [{
          type: 'tool_use',
          id: 'toolu_123',
          name: ' Glob',
          input: {pattern: '*.ts'},
        }]},
      ],
    };

    const result = anthropicToOpenAI(req);
    const toolCalls = (result.messages[1] as {tool_calls?: {function: {name: string}}[]}).tool_calls;
    expect(toolCalls?.[0].function.name).toBe('Glob');
  });

  it('should add stream_options when streaming', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      stream: true,
      messages: [{role: 'user', content: 'Hi'}],
    };

    const result = anthropicToOpenAI(req);
    expect(result.stream).toBe(true);
    expect((result as {stream_options?: {include_usage: boolean}}).stream_options).toEqual({include_usage: true});
  });

  it('should NOT add user message after tool messages', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'Test'},
        {role: 'assistant', content: [{type: 'tool_use', id: 'tool_1', name: 'bash', input: {}}]},
        {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tool_1', content: 'result'}]},
      ],
    };

    const result = anthropicToOpenAI(req);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('tool');
  });

  it('should add user message after assistant without tool_calls', () => {
    const req: AnthropicRequest = {
      model: 'claude-3',
      max_tokens: 1024,
      messages: [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi there'},
      ],
    };

    const result = anthropicToOpenAI(req);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('Continue.');
  });
});

describe('openAIToAnthropic edge cases', () => {
  it('should convert tool_calls to tool_use blocks', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'calculator', arguments: '{"expr": "2+2"}'},
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    const result = openAIToAnthropic(res, 'test-model');
    expect(result.stop_reason).toBe('tool_use');
    expect(result.content.some(c => c.type === 'tool_use')).toBe(true);
  });

  it('should handle malformed tool_call arguments', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'test', arguments: 'not valid json'},
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    const result = openAIToAnthropic(res, 'test-model');
    const toolUse = result.content.find(c => c.type === 'tool_use') as {input: {raw?: string}};
    expect(toolUse.input.raw).toBe('not valid json');
  });
});

// ============================================================================
// Mistral vLLM Compatibility Tests
// These tests cover edge cases for Mistral/vLLM compatibility handled by the proxy
// ============================================================================

describe('normalizeOpenAIToolIds - Mistral compatibility', () => {
  // Import the function being tested

  describe('index field stripping', () => {
    it('should strip index field from tool_calls', () => {
      const req = {
        model: 'devstral',
        messages: [
          {role: 'user', content: 'Hello'},
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              index: 0,
              id: 'call_123abc',
              type: 'function',
              function: {name: 'test', arguments: '{}'},
            }],
          },
        ],
      };

      const result = normalizeOpenAIToolIds(req);
      const toolCall = result.messages[1].tool_calls[0];
      
      expect(toolCall.index).toBeUndefined();
      expect(toolCall.id).toBeDefined();
      expect(toolCall.type).toBe('function');
    });

    it('should handle tool_calls without index field', () => {
      const req = {
        model: 'devstral',
        messages: [
          {role: 'user', content: 'Hi'},
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_abc123',
              type: 'function',
              function: {name: 'greet', arguments: '{"name":"world"}'},
            }],
          },
        ],
      };

      const result = normalizeOpenAIToolIds(req);
      const toolCall = result.messages[1].tool_calls[0];
      
      expect(toolCall.id).toBeDefined();
      expect(toolCall.function.name).toBe('greet');
    });

    it('should strip index from multiple tool_calls', () => {
      const req = {
        model: 'devstral',
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {index: 0, id: 'call_1', type: 'function', function: {name: 'a', arguments: '{}'}},
              {index: 1, id: 'call_2', type: 'function', function: {name: 'b', arguments: '{}'}},
              {index: 2, id: 'call_3', type: 'function', function: {name: 'c', arguments: '{}'}},
            ],
          },
        ],
      };

      const result = normalizeOpenAIToolIds(req);
      
      result.messages[0].tool_calls.forEach((tc: {index?: number}) => {
        expect(tc.index).toBeUndefined();
      });
    });
  });

  describe('JSON sanitization in arguments', () => {
    it('should keep valid JSON arguments unchanged', () => {
      const req = {
        model: 'devstral',
        messages: [{
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'test', arguments: '{"key": "value", "num": 42}'},
          }],
        }],
      };

      const result = normalizeOpenAIToolIds(req);
      expect(result.messages[0].tool_calls[0].function.arguments).toBe('{"key": "value", "num": 42}');
    });

    it('should replace truncated JSON with empty object', () => {
      const req = {
        model: 'devstral',
        messages: [{
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'test', arguments: '{"key": "value"'},  // Missing closing brace
          }],
        }],
      };

      const result = normalizeOpenAIToolIds(req);
      expect(result.messages[0].tool_calls[0].function.arguments).toBe('{}');
    });

    it('should replace malformed JSON with empty object', () => {
      const req = {
        model: 'devstral',
        messages: [{
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'test', arguments: 'not valid json at all'},
          }],
        }],
      };

      const result = normalizeOpenAIToolIds(req);
      expect(result.messages[0].tool_calls[0].function.arguments).toBe('{}');
    });

    it('should handle null/undefined arguments', () => {
      const req = {
        model: 'devstral',
        messages: [{
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {name: 'test', arguments: null},
          }],
        }],
      };

      const result = normalizeOpenAIToolIds(req);
      expect(result.messages[0].tool_calls[0].function.arguments).toBe('{}');
    });
  });
});


describe('filterEmptyAssistantMessages', () => {

  it('should keep assistant messages with content', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi there!'},
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(2);
  });

  it('should keep assistant messages with tool_calls but no content', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'user', content: 'Search for X'},
        {
          role: 'assistant',
          content: null,
          tool_calls: [{id: 'call_1', type: 'function', function: {name: 'search', arguments: '{}'}}],
        },
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(2);
  });

  it('should remove assistant messages with empty content and no tool_calls', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: ''},  // Empty content, no tool_calls
        {role: 'user', content: 'How are you?'},
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe('Hello');
    expect(result.messages[1].content).toBe('How are you?');
  });

  it('should remove assistant messages with null content and no tool_calls', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: null, tool_calls: null},
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(1);
  });

  it('should remove assistant messages with empty tool_calls array', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: '', tool_calls: []},
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(1);
  });

  it('should preserve other message roles', () => {
    const req = {
      model: 'devstral',
      messages: [
        {role: 'system', content: 'You are helpful'},
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: ''},  // Should be removed
        {role: 'tool', tool_call_id: 'call_1', content: 'result'},
      ],
    };

    const result = filterEmptyAssistantMessages(req);
    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m: {role: string}) => m.role)).toEqual(['system', 'user', 'tool']);
  });
});

describe('convertOpenAIStreamToAnthropic - streaming', () => {
  async function* mockStream(chunks: string[]): AsyncGenerator<string> {
    for (const chunk of chunks) yield chunk;
  }

  async function collectStream(gen: AsyncGenerator<string>): Promise<string[]> {
    const results: string[] = [];
    for await (const chunk of gen) results.push(chunk);
    return results;
  }

  it('should handle tool_calls in stream', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"test\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const results = await collectStream(convertOpenAIStreamToAnthropic(mockStream(chunks), 'test-model', 10));
    const joined = results.join('');

    expect(joined).toContain('content_block_start');
    expect(joined).toContain('tool_use');
    expect(joined).toContain('input_json_delta');
    expect(joined).toContain('content_block_stop');
  });

  it('should handle finish_reason length with usage chunk', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];

    const results = await collectStream(convertOpenAIStreamToAnthropic(mockStream(chunks), 'test-model', 10));
    const joined = results.join('');

    expect(joined).toContain('message_delta');
    expect(joined).toContain('message_stop');
  });

  it('should handle finish_reason tool_calls', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"test","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const results = await collectStream(convertOpenAIStreamToAnthropic(mockStream(chunks), 'test-model', 10));
    const joined = results.join('');

    expect(joined).toContain('tool_use');
  });

  it('should handle multiple tool_calls with arguments accumulation', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"fn1","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"fn2","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const results = await collectStream(convertOpenAIStreamToAnthropic(mockStream(chunks), 'test-model', 10));
    const joined = results.join('');

    expect(joined).toContain('fn1');
    expect(joined).toContain('fn2');
    expect(joined).toContain('input_json_delta');
  });
});
