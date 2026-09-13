# AI Playwright WASM Kernel

## Overview

The AI Playwright WASM Kernel is a **runtime-independent, portable state machine** for deterministic browser automation. It can execute entirely within a WASM module with planners and browser runtimes supplied as adapters.

The kernel proves the architectural boundary: the deterministic control loop is separated from specific implementations (WebLLM, Playwright, Obscura, etc.).

## Architecture

### Kernel Owns

- **Task** definition and limits
- **Observation** handling and staleness validation
- **Action validation** (schema, policy, element interactivity)
- **Policy validation** (origin, approval levels, key restrictions)
- **State machine transitions** (INITIAL → OBSERVE → PLAN → VALIDATE → EXECUTE → PASS/FAIL)
- **Trace** (canonical record of all steps with telemetry)
- **Evidence** (assertions and limit checks)
- **Replay** capability (steps are serializable)

### Host (Adapters) Owns

- **WebLLM** and model loading
- **Playwright** and browser automation
- **Obscura** and recording/streaming
- **CDP** and protocol details
- **Node.js** filesystem (artifacts, logging)
- **DOM** access and element finding
- **Model artifacts** and downloads

### Message Boundary

The kernel communicates with adapters exclusively through **serialized messages**:

```
                Host
                 │
                 ▼
        ┌─────────────────┐
        │   aipw-core.wasm│
        │                 │
Task ──►│ state machine   │
        │                 │
Obs  ──►│ validation      │
        │ policy          │
        │                 │
        │ BrowserAction ──┼──► Host Planner
        │                 │
        │ ExecutionResult◄┼── Host Browser
        │                 │
        │ trace/evidence  │
        └─────────────────┘
```

**Planner Contract:**

```typescript
PlannerRequest {
  task: Task
  observation: Observation
  policy: ActionPolicy
  history: Step[]
  remainingSteps: number
}

PlannerResponse {
  action: unknown  // Raw action (validated by kernel)
  model?: {
    provider: string
    model: string
    inferenceMs: number
    tokensIn?: number
    tokensOut?: number
  }
}
```

The kernel **never knows** whether the planner uses:
- WebLLM
- OpenAI
- Ollama
- Deterministic mock
- Any other provider

**Browser Contract:**

```typescript
BrowserRequest {
  action: BrowserAction
  observationId: string
}

BrowserResponse {
  result: {
    status: "success" | "failure"
    error?: string
    output?: string
  }
  observation?: Observation
  evidence?: Array<{
    type: "assertion" | "execution"
    assertion?: string
    result?: "passed" | "failed"
    detail?: string
  }>
}
```

The kernel **never knows** whether execution happens through:
- Playwright → Obscura
- Playwright → Chromium
- Remote browser
- Any other runtime

## State Machine

### INITIAL
Start state. Kernel requests first observation.

### OBSERVE
Fetch current DOM state. Validates against staleness by comparing observation IDs.

### PLAN
Send planner request with task, current observation, policy, history. Receive proposed action.

### VALIDATE
Parse and validate action:
1. Parse JSON schema
2. Find target elements in observation
3. Check element visibility/enablement
4. Validate navigation origins
5. Enforce approval policy

Transitions:
- Invalid → BLOCKED
- type:blocked → BLOCKED
- type:finish (no verification) → BLOCKED
- valid → EXECUTE

### EXECUTE
Call browser adapter to execute action. Record result.

Transitions:
- Failure (non-assert) → FAILED
- Success (assert or regular) → OBSERVE
- type:finish → PASSED

### Terminal States

- **PASSED**: Task goal verified, finish action executed successfully
- **FAILED**: Action execution failed (non-recoverable)
- **BLOCKED**: Policy violation, stale observation, step/time limit, planner error, or explicit blocked action

## Kernel Loop

```
INITIAL
   │
   ▼
OBSERVE ◄──────────────┐
   │                   │
   ▼                   │
PLAN                   │
   │                   │
   ▼                   │
VALIDATE               │
   │                   │
   ├── invalid ──► BLOCKED/FAIL
   │
   ▼
EXECUTE
   │
   ├── failure ──► FAILED
   │
   ├── finish ──► PASSED
   │
   └── continue ─┘
```

## Trace Model

Every step is recorded with complete context:

```typescript
Step {
  index: number
  observation: Observation      // DOM state at this step
  action: BrowserAction         // Validated action
  validation: StepResult        // Parse/validation outcome
  result: StepResult            // Execution outcome
  timestamp: number
  telemetry: {
    observationMs: number       // Time to fetch observation
    inferenceMs: number         // Time for planner
    validationMs: number        // Time to validate
    executionMs: number         // Time to execute
    inputTokens: number         // Estimated tokens
    outputTokens: number
  }
}
```

The trace is **canonical and owned by the kernel**. Adapters do not add their own trace entries; they only return results via the message boundary.

## Portable Kernel & WASM-Compatible Boundary

### Current: Portable JavaScript Kernel

The kernel is a **portable JavaScript/TypeScript implementation** with a **WASM-compatible message boundary**. It executes identically in Node.js, browsers, and future WASM runtimes.

```bash
npm run build:wasm
```

Outputs: `dist/wasm/` containing:
- `src/index.js` - Main export (Kernel, types, contracts)
- `src/state-machine.js` - State machine implementation
- `src/validation.js` - Action/policy validation
- `src/types.js` - Type definitions
- Type definitions (`.d.ts`) for IDE support

This demonstrates the **kernel boundary is real and portable**—the same kernel works whether:
- Running in Node.js
- Running in browser JavaScript
- Running in WASM (future)
- Running in cloud/edge runtimes

### Future: Genuine WASM Binary

The kernel can be compiled to a genuine `.wasm` binary via:
1. **wasm-pack** (Rust rewrite or TypeScript→Rust binding)
2. **Emscripten** (C++ rewrite)
3. **AssemblyScript** (TypeScript-like WASM language)

For now, the **portable JavaScript implementation with WASM-compatible boundary** proves the architecture is correct. Actual WASM compilation is an optimization for later, not required for correctness of the boundary.

## Testing

### Unit Tests

```bash
npm test -- tests/kernel/kernel.test.ts
```

Tests kernel logic with mock adapters:
- Complete task loop
- Policy validation
- Stale observation detection
- Step limit enforcement

### Acceptance Tests

```bash
npm test -- tests/kernel/wasm-acceptance.test.ts
```

Proves:
- Kernel independence (no WebLLM, Playwright, Node.js imports)
- Message-based boundary (all communication via contracts)
- Deterministic execution (same inputs → same outputs)
- Portable trace (JSON serializable)
- Runtime validation (no host dependencies)

### Message Boundary Tests

```bash
npm test -- tests/kernel/message-boundary.test.ts
```

**Critical proof** that the boundary is real:
- Serializes complete kernel conversation to JSON (PlannerRequest/Response, BrowserRequest/Response)
- Deserializes and verifies reconstruction
- Proves no closures, circular references, or non-JSON-serializable state
- Demonstrates message order preservation
- Confirms this is a genuine message-passing protocol, not just TypeScript interfaces

### Real Integration (PR #4)

The existing runtime tests in `tests/integration/mvp.test.ts` verify that the kernel integrates with real WebLLM, Playwright, and Obscura.

## Portability Proof

### ✅ Kernel Does NOT Import

- `@mlc-ai/web-llm` (model loading)
- `playwright` (browser automation)
- `obscura` (recording/streaming)
- `fs` (filesystem)
- `path` (filesystem paths)
- `CDP` (DevTools protocol)
- DOM APIs
- Node.js APIs

### ✅ Kernel Does Import

- `zod` (schema validation - pure JS)
- TypeScript standard library only

### ✅ Proof Strategy

1. **WASM-only E2E test** with mock adapters (no real browsers)
2. **No production fallback behavior** in kernel
3. **Explicit message contracts** between kernel and adapters
4. **Deterministic trace** proves reproducibility
5. **Real integration test** proves kernel works with actual implementations

## Non-Goals (This PR)

This PR explicitly does NOT include:

- ❌ Web UI
- ❌ Browser extension
- ❌ New planner implementation
- ❌ New model providers
- ❌ Remote execution
- ❌ `.aipw` artifact format
- ❌ WASM-compiled Obscura
- ❌ WASM-compiled WebLLM
- ❌ ABI optimization
- ❌ Persistence system
- ❌ Workflow builder
- ❌ Autonomous agent framework
- ❌ Action vocabulary expansion

**The point is boundary proof, not product expansion.**

## Next Steps (Future PRs)

After PR #5, the architecture enables:

1. **Web Platform Support**: Run WASM kernel + WebLLM/WebGPU + browser execution entirely in the browser (no server required)
2. **Offline Capability**: Package WASM kernel + local models + browser automation for offline use
3. **Multi-Provider**: Swap planners (OpenAI, Ollama, etc.) without changing kernel
4. **Deterministic Replay**: Re-run tasks from traces deterministically
5. **Workflow Builder**: Compose multi-task workflows using canonical trace format
6. **Autonomous Agents**: Build agent loops on top of portable kernel

## Files

- `src/types.ts` - Core type definitions
- `src/validation.ts` - Action and policy validation
- `src/adapter-contracts.ts` - Message-based adapter interfaces
- `src/state-machine.ts` - Kernel state machine implementation
- `src/index.ts` - Public API export
- `wasm/index.ts` - WASM entry point
- `wasm/mock-adapters.ts` - Mock adapters for testing
- `tests/kernel/kernel.test.ts` - Unit tests
- `tests/kernel/wasm-acceptance.test.ts` - Acceptance tests
