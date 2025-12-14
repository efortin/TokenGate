# Refactoring and Improvement Plan

> **Last updated**: 2024-12-14
> 
> **Current status**: Pipeline architecture implemented. Tests at 97.78% coverage.
> Some suggestions from this plan were implemented differently (KISS approach).

This document describes a detailed plan to improve the Token-Gate project, focusing on robustness, security, maintainability, and performance.

## Table of Contents

- [1. Introduction](#1-introduction)
- [2. Objectives](#2-objectives)
- [3. Current Analysis](#3-current-analysis)
- [4. Refactoring Plan](#4-refactoring-plan)
  - [4.1. Data Validation](#41-data-validation)
  - [4.2. Error Handling](#42-error-handling)
  - [4.3. Security](#43-security)
  - [4.4. Documentation](#44-documentation)
  - [4.5. Tests](#45-tests)
  - [4.6. Performance](#46-performance)
  - [4.7. Code Quality](#47-code-quality)
- [5. Prioritization](#5-prioritization)
- [6. Deliverables](#6-deliverables)
- [7. Conclusion](#7-conclusion)

## 1. Introduction

Token-Gate is an API service that acts as a gateway between Anthropic/OpenAI clients and various language model backends (vLLM, Mistral, etc.). The project is already well-structured but needed improvements to make it more robust, secure, and maintainable.

## 2. Objectives

The main objectives of this refactoring are:

1. **Improve robustness**: Better error handling and data validation
2. **Strengthen security**: Protect against injections and attacks
3. **Improve maintainability**: Better documentation and code structure
4. **Optimize performance**: Add caching and memory management
5. **Facilitate debugging**: Better logging and monitoring

## 3. Current Analysis

### Strengths ✅

- Well-designed pipeline architecture → **Implemented**: `pipe()`, `when()` in `pipeline.ts`
- Good separation of concerns → **Implemented**: routes, utils, services
- Effective use of TypeScript → **Implemented**: strict types
- Good unit test coverage → **Implemented**: 97.78% coverage, 135 tests
- Complete technical documentation → **Implemented**: `architecture.md`, `docs/vllm/`

### Identified Issues

- ~~Insufficient data validation~~ → KISS approach: TypeScript validation sufficient
- ~~Non-centralized error handling~~ → Per-route handling (acceptable for this project)
- No user input sanitization → **TODO** (low priority)
- ~~Missing API documentation~~ → `architecture.md` + `mistral-edge-cases.md`
- No backend request timeouts → **TODO** (medium priority)
- ~~Some duplicated constants~~ → Simplified with pipeline refactoring

## 4. Refactoring Plan

### 4.1. Data Validation

> **Status**: ⏭️ SKIPPED - KISS approach preferred
>
> Adding Zod would add a dependency and complexity. TypeScript types
> and vLLM runtime validation are sufficient for this proxy.

**Alternative implemented**:
- Strict types in `src/types/index.ts`
- Transformers that normalize data (`normalizeOpenAIToolIds`, `sanitizeToolChoice`)
- vLLM returns clear errors for invalid requests

### 4.2. Error Handling

> **Status**: ✅ IMPLEMENTED (simplified)
>
> KISS approach: error handling in each route with `try/catch` and `createApiError()`.
> A centralized middleware would add complexity without significant benefit.

**Implemented**:
- `createApiError()` and `formatSseError()` in `src/utils/http.ts`
- Logging with `req.log.error({err: e}, 'Request failed')` in each route
- Detailed backend errors in `streamBackend()` with context (messageCount, toolCount, etc.)

**Not implemented** (low priority):
- Centralized error middleware
- Custom error classes
- Correlation IDs

### 4.3. Security

> **Status**: ⚠️ PARTIAL
>
> Basic security implemented. The proxy is intended for internal use (homelab).

**Implemented**:
- Body size limit: 50MB (`app.ts`)
- API keys not logged
- `getBackendAuth()` handles backend authentication

**Not implemented** (low priority for internal use):
- Prompt sanitization
- Model whitelists
- Image URL validation

### 4.4. Documentation

> **Status**: ✅ IMPLEMENTED

**Implemented**:
- `docs/architecture.md` - Pipeline architecture with mermaid diagrams
- `docs/mistral-edge-cases.md` - Mistral/vLLM edge cases
- `docs/vllm/devstral-2-small.md` - Devstral 2x3090 config
- `docs/vllm/qwen3-coder.md` - Qwen3 Coder 2x3090 config

**Not implemented** (low priority):
- OpenAPI/Swagger (proxy is passthrough, not public API)
- Full JSDoc (code is simple enough)

### 4.5. Tests

> **Status**: ✅ IMPLEMENTED
>
> 135 tests, 97.78% coverage

**Implemented**:
- `pipeline.ts` tests via route tests (100% coverage)
- `auth.ts` tests (100% coverage)
- Streaming tests `convertOpenAIStreamToAnthropic`
- Legacy `/v1/completions` tests
- Vision backend config tests
- Error handling tests (empty stream, backend errors)

**Not implemented** (low priority):
- Performance tests
- Security tests (injections)

### 4.6. Performance

> **Status**: ⏭️ SKIPPED
>
> Proxy is lightweight and performant. Optimizations are premature for a homelab.

**Not implemented** (low priority):
- `/v1/models` cache - Infrequent calls
- Backend timeouts - Kubernetes HTTPRoute handles timeouts (1800s)
- Memory optimization - Node.js GC is sufficient

### 4.7. Code Quality

> **Status**: ✅ IMPLEMENTED
>
> KISS pipeline architecture with `pipe()` and `when()`.

**Implemented**:
- Pipeline pattern: `pipe()`, `when()` in `pipeline.ts` (11 lines)
- Simplified routes: `openai.ts` (117 lines), `anthropic.ts` (101 lines)
- Strict ESLint: 0 errors, 0 warnings
- CI with tests and lint

**Not implemented** (over-engineering):
- Repository pattern - Overkill for a simple proxy
- Dedicated classes - Composable functions are sufficient
- `constants.ts` - Little duplication after refactoring

## 5. Prioritization (Revised)

> The original plan proposed many abstractions. KISS approach was preferred.

### ✅ Done
- Pipeline architecture (`pipe()`, `when()`)
- Tests 97.78% coverage
- Complete documentation
- Strict ESLint

### ⏭️ Skipped (over-engineering)
- Zod validation
- Centralized error middleware
- Repository pattern
- OpenAPI/Swagger

### 📋 TODO (if needed in future)
- Explicit backend timeouts
- Prompt sanitization
- Performance tests

## 6. Deliverables

### Phase 1: Pipeline Architecture ✅ DONE

- [x] `pipe()` and `when()` pattern in `pipeline.ts`
- [x] Simplified routes (openai.ts: 117 lines, anthropic.ts: 101 lines)
- [x] Error handling in each route
- [x] Mistral/vLLM transformers (`normalizeOpenAIToolIds`, `sanitizeToolChoice`, etc.)

### Phase 2: Tests ✅ DONE

- [x] Pipeline tests (via route tests)
- [x] auth.ts tests (100% coverage)
- [x] Streaming tests `convertOpenAIStreamToAnthropic`
- [x] Legacy `/v1/completions` tests
- [x] Vision backend config tests
- [x] 135 tests, 97.78% coverage

### Phase 3: Documentation ✅ DONE

- [x] `docs/architecture.md` with mermaid diagrams
- [x] `docs/mistral-edge-cases.md`
- [x] `docs/vllm/devstral-2-small.md` (2x3090)
- [x] `docs/vllm/qwen3-coder.md` (2x3090)

### Phase 4: Performance ⏭️ SKIPPED

- [ ] `/v1/models` cache - Not needed
- [ ] Backend timeouts - Handled by Kubernetes HTTPRoute
- [ ] Memory optimization - Node.js GC is sufficient

## 7. Conclusion

The refactoring was done with a **KISS approach** rather than the more complex original plan.

**Result**:
- Simplified code ~230 lines (routes + pipeline)
- 135 tests, 97.78% coverage
- Complete documentation
- ESLint 0 errors

The project is now simpler, more maintainable, and well documented.
