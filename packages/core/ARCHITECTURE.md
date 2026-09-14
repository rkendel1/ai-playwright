# Runora Action System Architecture

## Overview

This document describes the redesigned Runora action system, which separates concerns across three layers:

1. **Element Locators** (finding elements)
2. **Action Schema** (defining what to do)
3. **Action Execution** (performing the action)
4. **Result Caching** (deterministic replay)

## Problem Statement

The original system had several limitations:

- **Tightly Coupled**: Element IDs and action definitions were inseparable
- **Brittle**: Any page change invalidated cached actions
- **Schema Validation**: Discriminator errors prevented valid actions from being recorded
- **Non-Deterministic**: Successful tests could produce different results on rerun
- **Model Bloat**: WebLLM models redownloaded on each session

## Architecture Layers

### Layer 1: Element Locators (`locator.ts`)

**Responsibility**: Find elements intelligently without requiring an LLM.

Locators support multiple discovery strategies:

```typescript
type ElementLocator =
  | { type: "id"; elementId: string }                    // Direct reference
  | { type: "observation"; observationId: string; elementId: string }  // Historical reference
  | { type: "role"; role: string; index?: number; label?: string }    // By ARIA role
  | { type: "text"; text: string; role?: string }       // By visible text
  | { type: "label"; label: string }                    // By form label
  | { type: "placeholder"; placeholder: string }       // By input placeholder
  | { type: "name"; name: string }                      // By element name
  | { type: "semantic"; intent: "search-input" | "login-form" | "submit-button" | "checkbox" | "dropdown" }  // Semantic search
  | { type: "xpath"; xpath: string }                    // XPath (server-side)
  | { type: "css"; selector: string }                   // CSS selector (server-side)
```

**Key Features**:

- **Confidence Scores**: Each match includes a confidence rating (0.0-1.0)
- **Fallback Locators**: Actions specify primary and fallback locators for resilience
- **Semantic Searches**: Find "search input" or "submit button" without an LLM
- **Cross-Observation Mapping**: Adapt successful locators from previous observations

### Layer 2: Action Schema (`action-schema.ts`)

**Responsibility**: Define actions with flexible element targeting.

```typescript
type BrowserAction =
  | { type: "click"; locator: ElementLocator; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "fill"; locator: ElementLocator; value: string; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "press"; locator: ElementLocator; key: string; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "select"; locator: ElementLocator; value: string; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "hover"; locator: ElementLocator; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "scroll"; direction: "up" | "down"; amount?: number } & ActionMeta
  | { type: "goto"; url: string; fallbacks?: string[] } & ActionMeta
  | { type: "wait"; ms: number } & ActionMeta
  | { type: "extract"; locator: ElementLocator; fallbackLocators?: ElementLocator[] } & ActionMeta
  | { type: "assert"; assertion: Assertion } & ActionMeta
  | { type: "finish"; result: "success" | "failure"; reason: string; evidence?: string } & ActionMeta
  | { type: "blocked"; reason: string; suggestion?: string } & ActionMeta
```

**Key Improvements**:

- **Locator-Based**: Actions reference elements via locators, not IDs
- **Fallbacks**: Primary and fallback locators for resilience
- **Better Assertions**: Support element state checks, not just text
- **Rich Metadata**: Confidence, risk, reason, and recorded source
- **Failure Cases**: "failure" and "blocked" provide richer context

### Layer 3: Action Execution (`action-executor.ts`)

**Responsibility**: Execute validated actions with proper error handling.

```typescript
class ActionExecutor {
  async execute(
    action: unknown,
    observation: Observation,
    policy: ActionPolicy = {}
  ): Promise<ExecutionResult>
}
```

**Execution Flow**:

1. **Validation**: Parse and validate action schema
2. **Resolution**: Find element using locator (with fallbacks)
3. **Policy Check**: Verify navigation and approval requirements
4. **Execution**: Perform the action (click, fill, etc.)
5. **Telemetry**: Record execution time and result

### Layer 4: Result Caching (`action-cache.ts`)

**Responsibility**: Store and replay successful action sequences deterministically.

```typescript
type CachedTaskResult = {
  taskId: string;
  goal: string;
  url: string;
  steps: CachedStep[];
  result: "success" | "failure" | "blocked";
  completedAt: number;
  durationMs: number;
  confidence: number;
}
```

**Key Features**:

- **Browser-Local Storage**: Uses localStorage for persistence across sessions
- **Cross-Observation Adaptation**: Maps cached actions to current page state
- **Confidence Filtering**: Only reuses high-confidence (>0.8) results
- **Automatic Replay**: Tests with cached results skip LLM inference

## Migration Path

### From Old System

**Old Action**:
```typescript
{
  type: "fill",
  target: { observationId: "obs-1", elementId: "e42" },
  value: "search term"
}
```

**New Action**:
```typescript
{
  type: "fill",
  locator: { type: "id", elementId: "e42" },
  value: "search term",
  fallbackLocators: [
    { type: "semantic", intent: "search-input" },
    { type: "placeholder", placeholder: "Search" }
  ]
}
```

### Benefits

1. **Resilience**: Fallback locators handle page changes
2. **Clarity**: Semantic intents are self-documenting
3. **Determinism**: Cached results eliminate LLM randomness
4. **Performance**: No re-inference on successful reruns

## WebLLM Model Caching

Models are cached in the browser via:

1. **IndexedDB**: Large model weights stored persistently
2. **localStorage**: Cache metadata and access logs
3. **Persistent Storage**: Browser requests permission for persistent storage

**Configuration** (in workspace config):
```typescript
export default {
  persistentStorage: {
    enabled: true,
    maxSizeBytes: 5 * 1024 * 1024 * 1024, // 5GB
  },
  modelCaching: {
    preload: ["Llama-3.2-1B-Instruct-q4f16_1-MLC"],
    revalidateAfterDays: 7,
  },
};
```

## Deterministic Test Execution

### Phase 1: Initial Run (LLM-Guided)

1. User describes test in natural language
2. WebLLM generates action sequence
3. Actions executed with telemetry
4. Result cached with high confidence

### Phase 2: Replay Runs (Deterministic)

1. Check cache for task/URL combination
2. If high-confidence result exists, use cached steps
3. Map cached locators to current observation
4. Execute without LLM inference
5. Compare result for regression detection

### Cache Invalidation

Results are invalidated if:

- **URL changes** significantly (different domain)
- **Confidence drops** below threshold (0.8)
- **Explicit invalidation** via user request
- **Age exceeds** TTL (default: 30 days)

## Error Recovery

When a locator fails to resolve:

```typescript
// Primary locator fails
{ type: "id", elementId: "old-id" }

// Try fallbacks in order
{ type: "semantic", intent: "search-input" }
{ type: "placeholder", placeholder: "Search" }
{ type: "role", role: "searchbox" }

// If all fail, throw clear error with suggestions
throw new Error(
  "Unable to resolve search input. " +
  "Suggestions: page layout may have changed, " +
  "element may be hidden, or new locators needed."
);
```

## Policy Validation

Actions are validated against policies before execution:

```typescript
type ActionPolicy = {
  allowedOrigins?: string[];      // Restrict navigation
  approval?: "never" | "destructive" | "all";  // Require approval for risky actions
  allowedKeys?: string[];         // Restrict keyboard input
};
```

**Risk Levels**:
- `read`: Observations, extractions (no changes)
- `write`: Clicks, form fills, navigation
- `destructive`: Delete, remove, purchase, publish actions

## Testing Determinism

```typescript
// First run: generates and caches
const result1 = await browser.task("Create project named 'Demo'");
console.assert(result1.status === "passed");

// Second run: uses cache, no LLM
const result2 = await browser.task("Create project named 'Demo'");
console.assert(result2.status === "passed");
console.assert(result2.steps.length === result1.steps.length);

// All steps should be identical (same actions, same elements)
for (let i = 0; i < result1.steps.length; i++) {
  const step1 = result1.steps[i];
  const step2 = result2.steps[i];
  console.assert(step1.action.type === step2.action.type);
}
```

## Future Enhancements

### Vision-Based Locators

```typescript
{ type: "visual"; description: "red button in top-right"; confidence: 0.85 }
```

### Custom Extractors

```typescript
{ type: "extract"; locator: {...}; extractFn: (text) => JSON.parse(text) }
```

### Smart Retry Strategies

```typescript
{ type: "click"; locator: {...}; retry: { maxAttempts: 3, backoff: "exponential" } }
```

### Multi-Step Composites

```typescript
{
  type: "composite";
  steps: [
    { type: "click"; locator: {...} },
    { type: "wait"; ms: 500 },
    { type: "fill"; locator: {...}; value: "text" }
  ]
}
```

## Example: Search and Submit Flow

**Without Caching (First Run)**:
1. LLM generates: "click search input, fill query, press Enter"
2. Planner converts to actions with semantic locators
3. Executor resolves semantic "search-input" locator
4. Finds `<input placeholder="Search">` with confidence 0.95
5. Cache stores: successful action sequence

**With Caching (Second Run)**:
1. Check cache for same task/URL
2. Found: successful result from previous run
3. Skip LLM entirely
4. Adapt cached locators to current observation
5. Execute cached steps deterministically
6. 100% reproducible results

## Integration with Planner

Planners (WebLLM, OpenAI, etc.) generate actions like:

```typescript
{
  type: "click",
  locator: {
    type: "semantic",
    intent: "search-input"
  },
  fallbackLocators: [
    { type: "role", role: "searchbox" },
    { type: "placeholder", placeholder: "Search" }
  ],
  reason: "User wants to search",
  confidence: 0.9
}
```

The planner specifies **what** and the executor handles **how** to find it.

## Debugging & Observability

Enable debug logging:

```typescript
const executor = new ActionExecutor(page);
executor.debug = true;  // Logs all locator resolution attempts
```

Output example:
```
[ActionExecutor] Resolving locator: { type: "semantic", intent: "search-input" }
[ActionExecutor]   Trying role=searchbox... found, confidence=0.95
[ActionExecutor]   Using element: e42 (<input placeholder="Search">)
[ActionExecutor] Executing click on e42
[ActionExecutor]   Success in 42ms
```

## Backward Compatibility

Old system's action IDs are converted automatically:

```typescript
// Old
{ type: "click", target: { observationId: "obs-1", elementId: "e42" } }

// Automatically converted to
{ type: "click", locator: { type: "observation", observationId: "obs-1", elementId: "e42" } }
```

This ensures existing tests continue to work while new features are adopted gradually.
