# Mistral vLLM Compatibility Edge Cases

This document covers all edge cases handled by the token-gate proxy for Mistral/vLLM compatibility.
These fixes were implemented to handle incompatibilities between OpenAI-style clients (like Mistral Vibe)
and vLLM's mistral-common tokenizer.

## Edge Cases Covered

### 1. Index Field in Tool Calls

**Problem**: OpenAI-style tool calls include an `index` field, but `mistral-common` uses Pydantic with
`extra = "forbid"` and rejects it.

**Error**:
```
ValidationError: 1 validation error for ToolCall
index
  Extra inputs are not permitted [type=extra_forbidden, input_value=0, input_type=int]
```

**Solution**: Strip `index` field from all tool_calls in assistant messages before forwarding to vLLM.

**Location**: `src/utils/convert.ts` - `normalizeOpenAIToolIds()`

**Test Cases**:
- Tool call with index field → index removed
- Tool call without index field → unchanged  
- Multiple tool calls → all indices removed
- Nested in conversation history → all stripped

---

### 2. Malformed JSON in Tool Call Arguments

**Problem**: Sometimes tool call arguments contain malformed JSON (truncated, missing delimiters).
vLLM's mistral tokenizer tries to parse this and crashes.

**Error**:
```
JSONDecodeError: Expecting ',' delimiter: line 1 column 1298 (char 1297)
```

**Solution**: Validate JSON in `function.arguments`, replace with `'{}'` if invalid.

**Location**: `src/utils/convert.ts` - `normalizeOpenAIToolIds()`

**Test Cases**:
- Valid JSON arguments → unchanged
- Truncated JSON → replaced with `{}`
- Missing delimiter → replaced with `{}`
- Empty string arguments → replaced with `{}`
- Null arguments → replaced with `{}`

---

### 3. Empty Assistant Messages

**Problem**: Compact operations sometimes generate assistant messages with `content=''` and no tool_calls.
Mistral tokenizer rejects these as invalid.

**Error**:
```
TokenizerException: Invalid assistant message: role='assistant' content='' tool_calls=None prefix=False
```

**Solution**: Filter out assistant messages that have empty content AND no tool_calls.

**Location**: `src/utils/convert.ts` - `filterEmptyAssistantMessages()`

**Test Cases**:
- Assistant with content → kept
- Assistant with tool_calls but no content → kept
- Assistant with both content and tool_calls → kept
- Assistant with empty content and no tool_calls → removed
- Assistant with empty content and empty tool_calls array → removed

---

### 4. Tool Call ID Normalization (9-digit Mistral format)

**Problem**: Mistral requires tool call IDs to be exactly 9 alphanumeric characters.
OpenAI clients may generate longer IDs.

**Solution**: Normalize tool call IDs by taking last 9 characters or padding if shorter.

**Location**: `src/utils/convert.ts` - `normalizeToolId()`, `normalizeOpenAIToolIds()`

**Test Cases**:
- Long ID (> 9 chars) → last 9 chars used
- Short ID (< 9 chars) → padded appropriately
- Exactly 9 chars → unchanged
- ID with special characters → normalized

---

## Configuration Required

### vLLM Deployment (`flux/vllm/deployment.yaml`)
```yaml
args:
  - "--tool-call-parser"
  - "mistral"
  - "--enable-auto-tool-choice"
  - "--max-model-len"
  - "140000"
```

### Vibe Configuration (`~/.vibe/config.toml`)
```toml
active_model = "devstral"
auto_compact_threshold = 119000  # 85% of max-model-len

[[providers]]
name = "vllm-direct"
api_base = "http://localhost:3456/v1"  # Through token-gate proxy
api_key_env_var = "VLLM_API_KEY"
api_style = "openai"
backend = "generic"  # Required for non-Mistral API endpoints
```

### Token-Gate Proxy
```env
VLLM_URL=https://openai.sir-alfred.io
VLLM_API_KEY=sk-vllm-workstation-2024-prod
```

---

## Request Flow

```
Vibe Client (OpenAI format)
    ↓
Token-Gate Proxy (localhost:3456)
    ↓ filterEmptyAssistantMessages()
    ↓ normalizeOpenAIToolIds()  → strips index, sanitizes JSON
    ↓ sanitizeToolChoice()
    ↓
vLLM Server (--tool-call-parser mistral)
    ↓ mistral-common tokenizer
    ↓
Devstral Model
```

---

## Refactoring Notes

When refactoring, ensure:
1. All transformations are idempotent (can be applied multiple times safely)
2. Original message structure is preserved (only problem fields modified)
3. Error handling doesn't crash the proxy (graceful degradation)
4. Logging captures when transformations are applied for debugging
