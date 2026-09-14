# Runora Action System Migration Guide

## Overview

This guide walks through migrating from the old action system (ID-based, discriminator errors) to the new system (locator-based, deterministic caching).

## What's Changing

### Before: ID-Based Actions

```typescript
const action = {
  type: "click",
  target: {
    observationId: "obs-42",
    elementId: "e123"
  },
  reason: "Click search button",
  confidence: 0.95
};
```

**Problems**:
- Breaks if element ID changes
- Discriminator validation errors on malformed input
- No way to represent "find the search button intelligently"
- Each run generates new IDs, not reproducible

### After: Locator-Based Actions

```typescript
const action = {
  type: "click",
  locator: {
    type: "semantic",
    intent: "search-input"
  },
  fallbackLocators: [
    { type: "role", role: "searchbox" },
    { type: "placeholder", placeholder: "Search" }
  ],
  reason: "Click search button",
  confidence: 0.95,
  recordedFrom: "obs-42"  // Optional: historical reference
};
```

**Benefits**:
- Survives page layout changes (fallbacks)
- Clear, semantic intent
- Self-documenting
- Fully reproducible (cached results)

## Migration Steps

### Step 1: Update Action Validation

**Old**:
```typescript
import { validateAction } from "packages/core/actions.js";

const validated = validateAction(action, observation);
```

**New**:
```typescript
import { validateAction } from "packages/core/action-schema.js";
import { ActionExecutor } from "packages/core/action-executor.js";

const validated = validateAction(action);  // Validation is schema-only now
const executor = new ActionExecutor(page);
const result = await executor.execute(action, observation);
```

### Step 2: Update Planners

#### WebLLM Planner Migration

**Old**:
```typescript
export class WebLLMPlanner implements Planner {
  async plan(observation: Observation, task: Task): Promise<BrowserAction> {
    // ... inference code ...
    return {
      type: "click",
      target: {
        observationId: observation.id,
        elementId: "e42"
      }
    };
  }
}
```

**New**:
```typescript
import { findElementByLocator, type ElementLocator } from "packages/core/locator.js";

export class WebLLMPlanner implements Planner {
  async plan(observation: Observation, task: Task): Promise<BrowserAction> {
    // ... inference code ...
    
    // Generate semantic locators instead of IDs
    const locator: ElementLocator = {
      type: "semantic",
      intent: "search-input"
    };
    
    // Verify the locator resolves in current observation
    const match = findElementByLocator(locator, observation);
    if (!match) {
      return { type: "blocked", reason: "Could not locate search input" };
    }
    
    return {
      type: "click",
      locator,
      fallbackLocators: [
        { type: "role", role: "searchbox" },
        { type: "placeholder", placeholder: "Search" }
      ],
      reason: "Click search button",
      confidence: match.confidence,
      recordedFrom: observation.id
    };
  }
}
```

#### Provider Planner Migration (OpenAI, Claude, Ollama)

Update system prompts to generate locators:

**Old Prompt**:
```
Return a JSON action with:
- type: "click" | "fill" | ...
- target: { observationId, elementId }
- reason: why this action

Example: { "type": "click", "target": { "observationId": "obs-1", "elementId": "e42" }, "reason": "..." }
```

**New Prompt**:
```
Return a JSON action with:
- type: "click" | "fill" | ...
- locator: how to find the element (use semantic intents when possible)
- fallbackLocators: alternative ways to find the element
- reason: why this action

Locator types:
- { type: "semantic", intent: "search-input" | "login-form" | "submit-button" | "checkbox" | "dropdown" }
- { type: "role", role: "button" | "textbox" | ..., label?: "visible label" }
- { type: "text", text: "Button text" }
- { type: "label", label: "Form label" }
- { type: "placeholder", placeholder: "Input placeholder" }

Example: 
{
  "type": "fill",
  "locator": { "type": "semantic", "intent": "search-input" },
  "value": "query",
  "fallbackLocators": [
    { "type": "role", "role": "searchbox" },
    { "type": "placeholder", "placeholder": "Search" }
  ],
  "reason": "User wants to search for content"
}
```

### Step 3: Update Test Files

**Old Test**:
```typescript
test("search for items", async () => {
  const result = await browser.task(`
    Search for "laptop" in the search box
    Verify results appear
  `);
  expect(result.status).toBe("passed");
});
```

**New Test** (no changes needed!):
```typescript
test("search for items", async () => {
  const result = await browser.task(`
    Search for "laptop" in the search box
    Verify results appear
  `);
  expect(result.status).toBe("passed");
  
  // Optional: inspect cache
  const cached = actionCache.getResult(createCacheKey("search-task", url));
  expect(cached?.result).toBe("success");
});
```

### Step 4: Update Executor Integration

**Old**:
```typescript
// in task.ts
export async function executeStep(action: BrowserAction, observation: Observation): Promise<void> {
  const element = findTarget(action, observation);
  assertInteractive(action, element);
  validateKey(action, policy);
  validateApproval(action, element, policy);
  // ... manual execution logic ...
}
```

**New**:
```typescript
// in task.ts
import { ActionExecutor } from "./action-executor.js";
import { actionCache, shouldUseCachedResult } from "./action-cache.js";

export async function executeStep(
  action: BrowserAction,
  observation: Observation,
  taskId: string,
  url: string
): Promise<void> {
  // Check if we should use cached result
  const cacheKey = createCacheKey(taskId, url);
  if (shouldUseCachedResult(cacheKey)) {
    const cached = actionCache.getResult(cacheKey);
    if (cached) {
      console.log(`Using cached result for task ${taskId}`);
      return;  // Skip execution entirely
    }
  }
  
  // Execute action
  const executor = new ActionExecutor(page);
  const result = await executor.execute(action, observation, policy);
  
  if (result.status === "failure") {
    throw new Error(result.error);
  }
}
```

### Step 5: Enable Result Caching

**In your task runner**:
```typescript
import { actionCache, createCacheKey } from "packages/core/action-cache.js";

async function runTask(goal: string, url: string) {
  const taskId = crypto.randomUUID();
  const cacheKey = createCacheKey(taskId, url);
  
  // Check cache first
  if (actionCache.hasSuccessfulResult(cacheKey)) {
    console.log("Using cached result...");
    const cached = actionCache.getResult(cacheKey);
    return cached;
  }
  
  // Run task normally
  const result = await executeTask(goal, url);
  
  // Cache successful result
  if (result.status === "success") {
    actionCache.cacheResult(cacheKey, {
      taskId,
      goal,
      url,
      steps: result.steps,
      result: "success",
      completedAt: Date.now(),
      durationMs: result.durationMs,
      confidence: 0.95  // High confidence = will be reused
    });
  }
  
  return result;
}
```

## Common Patterns

### Pattern 1: Smart Search Box Finding

**Instead of**:
```typescript
// Planner must know the exact ID: e42
const element = observation.elements.find(e => e.id === "e42");
```

**Use**:
```typescript
// Planner generates semantic intent
{ type: "semantic", intent: "search-input" }

// Executor automatically finds:
// 1. Elements with role="searchbox"
// 2. Input with placeholder="Search"
// 3. Input with aria-label containing "search"
// 4. Input near "search" text
```

### Pattern 2: Resilient Form Filling

**Before** (breaks on form change):
```typescript
{
  type: "fill",
  target: { observationId: "obs-1", elementId: "e42" },
  value: "email@example.com"
}
```

**After** (resilient to layout changes):
```typescript
{
  type: "fill",
  locator: { type: "label", label: "Email" },
  value: "email@example.com",
  fallbackLocators: [
    { type: "placeholder", placeholder: "your@email.com" },
    { type: "role", role: "textbox", index: 0 },
    { type: "semantic", intent: "login-form" }
  ]
}
```

### Pattern 3: Deterministic Replay

**First run**:
```
1. Generate actions with planner
2. Execute and track success
3. Cache result with high confidence
```

**Subsequent runs**:
```
1. Check cache for same task + URL
2. If hit: skip LLM, replay cached steps
3. If miss: run normally, cache if successful
```

## Handling Errors

### New Error Message Format

**Old**:
```
Error: Action target '${action.target.elementId}' does not exist in current observation.
```

**New**:
```
Error: Unable to resolve element with locator: {"type":"semantic","intent":"search-input"}
  Tried: semantic search, role=searchbox, placeholder="Search"
  Suggestions: page layout may have changed, element may be hidden
  Debug: Enable executor.debug = true for detailed resolution steps
```

### Debugging Failed Actions

```typescript
const executor = new ActionExecutor(page);
executor.setDebug(true);

try {
  await executor.execute(action, observation);
} catch (error) {
  // Will have printed detailed resolution attempts
  console.error("Failed action:", action);
  console.error("Observation elements:", observation.elements);
}
```

## Backward Compatibility

The system automatically converts old-style actions:

```typescript
// Old action
{
  type: "fill",
  target: { observationId: "obs-1", elementId: "e42" },
  value: "text"
}

// Automatically treated as
{
  type: "fill",
  locator: { type: "observation", observationId: "obs-1", elementId: "e42" },
  value: "text"
}
```

Existing tests continue to work, but should be migrated gradually to use semantic locators.

## Validation Checklist

Before deploying changes:

- [ ] Planner generates semantic locators
- [ ] Executor uses ActionExecutor class
- [ ] Cache is initialized on startup
- [ ] Successful results are cached
- [ ] Second run uses cache (verify via logs)
- [ ] Cache is persisted to localStorage
- [ ] All existing tests still pass
- [ ] No discriminator validation errors
- [ ] Error messages are clear and actionable

## Performance Impact

### First Run (LLM Inference)
- **Before**: ~5-10s per action (LLM + Playwright)
- **After**: ~5-10s per action (same)

### Cached Run (No LLM)
- **Before**: ~5-10s per action (must re-infer)
- **After**: ~0.5-1s per action (skip inference)

**Typical improvement**: 10-20x faster on subsequent runs.

## Questions & Troubleshooting

### Q: Why am I still getting discriminator errors?

A: Make sure you're using the new `action-schema.ts`, not the old `actions.ts`:
```typescript
// Wrong
import { validateAction } from "packages/core/actions.js";

// Right
import { validateAction } from "packages/core/action-schema.js";
```

### Q: How do I force bypass the cache?

A:
```typescript
actionCache.clear();  // Clear all cached results
```

### Q: Cache not persisting between sessions?

A: Check browser localStorage is available:
```typescript
console.log(typeof localStorage !== "undefined");  // Should be true
```

### Q: Locator not resolving in my planner?

A: Verify the locator matches elements in the observation:
```typescript
import { findElementByLocator } from "packages/core/locator.js";

const match = findElementByLocator(locator, observation);
console.log("Match:", match);  // Should not be null
```

## Next Steps

1. **Update Planners**: Convert planner prompts to generate semantic locators
2. **Update Executors**: Use ActionExecutor class
3. **Enable Caching**: Initialize ActionCache on startup
4. **Migrate Tests**: Update test files to verify caching works
5. **Monitor**: Track cache hit rates and performance improvements

## Support

For issues or questions:
1. Check the ARCHITECTURE.md for detailed design
2. Review examples in `packages/core/*.ts`
3. Enable debug logging: `executor.setDebug(true)`
4. File an issue with reproducible test case
