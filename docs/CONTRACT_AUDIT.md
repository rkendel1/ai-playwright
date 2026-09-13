# Contract Audit: PR #7 Sketches vs PR #5 Kernel

## Objective

Verify that PR #7's architectural sketches (adapters, CLI design) actually work against the real PR #5 kernel interfaces, or identify concrete gaps that prevent the proposed CLI scenario from working.

**Scenario being audited:**
```bash
$ npx ai-playwright --url http://localhost:3000 "test checkout"
```

---

## PR #7 Sketch Architecture

### Assumed Planner Interface
```typescript
// PR #7 sketch assumed:
interface PlannerAdapter {
  plan(request: PlannerRequest): Promise<PlannerResponse>;
}

type PlannerRequest = {
  task: string;
  observation: Observation;
  policy: ActionPolicy;
  history: Step[];
  remainingSteps: number;
};

type PlannerResponse = {
  action: BrowserAction;
  metadata?: { model: string; tokens?: {in, out} };
};
```

### Assumed Browser Executor Interface
```typescript
// PR #7 sketch assumed:
interface BrowserAdapter {
  observe(): Promise<Observation>;
  execute(request: BrowserRequest): Promise<BrowserResponse>;
}

type BrowserRequest = {
  action: BrowserAction;
  observationId: string;
};

type BrowserResponse = {
  result: { status: "success" | "rejected" | "failed"; reason?: string };
  observation?: Observation;
};
```

### Assumed Trace Format
```typescript
// PR #7 sketch assumed:
interface TaskResult {
  id: string;
  status: "passed" | "failed" | "blocked";
  goal: string;
  steps: Step[];
  evidence: { initialState, finalState, actionSequence, duration };
  telemetry: { observationCount, inferenceCount, ... };
  deploymentMode?: "cli" | "browser-local";
}
```

---

## Actual PR #5 Kernel Contracts

### Actual Planner Interface (from `packages/core/planner.ts`)
```typescript
type PlannerInput = {
  task: string;
  observation: Observation;
  history: Step[];
  remainingSteps: number;
  defaultUrl?: string;
};

interface Planner {
  readonly provider?: string;
  next(input: PlannerInput): Promise<BrowserAction>;
  plan?(input: Omit<PlannerInput, "history" | "remainingSteps">): Promise<BrowserAction[]>;
}
```

**Gap Analysis:**
- ✅ Input structure is similar (task, observation, history, remainingSteps)
- ✅ Returns BrowserAction (same)
- ❌ Missing metadata in response (no model, tokens, reasoning returned)
- ❌ No policy passed to planner (policy validation is separate)
- ⚠️ Method name is `next()` not `plan()`; has optional `plan()` for batch
- ⚠️ Provider is optional string property, not metadata returned per-call

### Actual Browser Executor Interface (from `packages/core/executor.ts`)
```typescript
type ActionResult = {
  status: "success" | "failure";
  error?: string;
  output?: string;
};

interface BrowserExecutor {
  execute(page: Page, action: BrowserAction, observation: Observation): Promise<ActionResult>;
}
```

**Gap Analysis:**
- ✅ Executes BrowserAction (same)
- ❌ No separate `observe()` method (observation is passed as input)
- ❌ Takes `page: Page` directly (Playwright dependency in interface!)
- ❌ Doesn't return updated observation (only ActionResult)
- ❌ Status enum only has "success" | "failure", not "rejected"
- ⚠️ Observation is captured separately by `observe(page)` function, not by executor

### Actual Observation Structure (from `packages/core/observer.ts`)
```typescript
type ElementObservation = {
  id: string;
  role?: string;
  name?: string;
  value?: string;
  state: { visible: boolean; enabled: boolean; checked?: boolean };
};

type Observation = {
  id: string;
  generation: number;
  url: string;
  title: string;
  elements: ElementObservation[];
  text?: string;
};
```

**Gap Analysis:**
- ✅ Has element list (similar to sketch)
- ⚠️ Uses `generation` counter instead of just `id` for staleness detection
- ✅ Elements have visibility and enabled state (needed for validation)
- ⚠️ Element `id` is auto-assigned (`e1`, `e2`, etc.), not developer-controlled

### Actual BrowserAction Types (from `packages/core/actions.ts`)
```typescript
type BrowserAction =
  | { type: "goto"; url: string }
  | { type: "click"; target: Target }
  | { type: "fill"; target: Target; value: string }
  | { type: "press"; target: Target; key: string }
  | { type: "select"; target: Target; value: string }
  | { type: "hover"; target: Target }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; ms: number }
  | { type: "extract"; target: Target }
  | { type: "assert"; assertion: Assertion }
  | { type: "finish"; result: "success"; reason: string }
  | { type: "blocked"; reason: string };

type Target = { observationId: string; elementId: string };
type Assertion = 
  | { type: "textVisible"; text: string }
  | { type: "urlIncludes"; value: string };
```

**Gap Analysis:**
- ✅ Comprehensive action set (click, fill, assert, etc.)
- ✅ Target includes observationId (staleness detection)
- ⚠️ Press, select, scroll, hover, wait, extract not sketched but available
- ✅ Assert has textVisible and urlIncludes
- ⚠️ finish/blocked are actions, not state machine results
- ⚠️ No screenshot action (architectural limit for now)

### Actual TaskResult Format (from `packages/core/evidence.ts`)
```typescript
type TaskResult = {
  status: "passed" | "failed" | "blocked";
  steps: Step[];
  evidence: Evidence[];
  error?: TaskError;
  artifactsPath: string;
  durationMs: number;
};

type Step = {
  index: number;
  observation: unknown;
  action: unknown;
  validation: StepResult;
  result: StepResult;
  timestamp: number;
  telemetry?: StepTelemetry;
};

type StepTelemetry = {
  observationMs: number;
  inferenceMs: number;
  validationMs: number;
  executionMs: number;
  inputTokens: number;
  outputTokens: number;
};
```

**Gap Analysis:**
- ✅ Has status, steps, telemetry (similar to sketch)
- ❌ No `deploymentMode` field (not tracking which mode ran)
- ⚠️ Evidence is separate array of assertion results, not full initial/final state
- ⚠️ No `goal` field in result (task goal not preserved)
- ✅ Has detailed telemetry per step (inferenceMs, validationMs, etc.)
- ✅ Has artifacts path (for screenshots, logs, etc.)

---

## Contract Audit Findings

### Critical Gap #1: Browser Executor Takes Playwright Page Directly

**Problem:**
```typescript
// Actual kernel interface:
interface BrowserExecutor {
  execute(page: Page, action: BrowserAction, observation: Observation): Promise<ActionResult>;
  //       ↑ Playwright Page object passed directly
}
```

The kernel's BrowserExecutor interface requires a Playwright `Page` object. This means:

❌ **Cannot implement a browser-local executor** (no Playwright.Page in browser)
❌ **Executor is bound to Playwright** (not truly adapter pattern)
✅ **CLI can use this** (Playwright available in Node.js)

**Impact on PR #7 design:**
- Browser-local mode (secondary deployment) cannot use the real BrowserExecutor interface
- Would need a different executor interface or wrapper
- The "same kernel, different adapters" goal is partially blocked

**Is this fatal to the CLI scenario?**
- ❌ No. CLI mode works fine with PlaywrightBrowserExecutor.
- ✅ But it means browser-local mode cannot share the real BrowserExecutor

---

### Critical Gap #2: No Observation Method in BrowserExecutor

**Problem:**
```typescript
// Actual kernel: observe() is a separate function, not executor method
export async function observe(page: Page): Promise<Observation>;

// Executor only handles actions:
interface BrowserExecutor {
  execute(page: Page, action: BrowserAction, observation: Observation): Promise<ActionResult>;
  // No observe() method
}
```

The kernel manages observation separately. This means:

✅ **Observation is decoupled** (good for testing)
❌ **Cannot implement browser-local observation differently** (would need fork of observation logic)
⚠️ **Observation is tied to Playwright page** (works in Node.js, not in browser)

**Impact on PR #7 design:**
- Cannot truly abstract browser observation
- Browser-local mode would need its own observation implementation (outside executor)

---

### Critical Gap #3: No Metadata Return from Planner

**Problem:**
```typescript
// PR #7 sketch assumed:
type PlannerResponse = {
  action: BrowserAction;
  metadata?: { model: string; tokens?: {in, out} };  // ← Expected
};

// Actual kernel:
interface Planner {
  next(input: PlannerInput): Promise<BrowserAction>;  // ← No metadata
  readonly provider?: string;  // ← Provider is class property, not per-call
}
```

The planner returns only BrowserAction, no per-call metadata. This means:

❌ **Cannot track which model was used for each action** (only class-level provider)
❌ **Cannot capture LLM token counts** (not in response)
✅ **Can capture in TaskResult.telemetry** (inferenceMs is tracked)

**Impact on PR #7 design:**
- Evidence trace won't include "which model generated this action"
- Token counts must be managed outside the planner interface
- CLI needs to track this separately

---

### Critical Gap #4: No "Rejected" Status for Actions

**Problem:**
```typescript
// PR #7 sketch assumed:
type ActionResult = {
  status: "success" | "rejected" | "failed";
  reason?: string;
};

// Actual kernel:
type ActionResult = {
  status: "success" | "failure";
  error?: string;
};
```

The kernel only has "success" or "failure", no "rejected" state. This affects capability negotiation:

❌ **Cannot signal "I can't do this" separately from "this failed"**
⚠️ **A rejected action looks like a failure to the kernel**

**Impact on capability negotiation (PR #7 Gate 2):**
- Runtime rejection becomes indistinguishable from actual failure
- Planner can't learn "this executor doesn't support screenshots" vs "screenshot failed"
- Works for MVP but limits sophisticated capability negotiation

---

### Gap #5: No Policy Parameter to Planner

**Problem:**
```typescript
// PR #7 sketch:
type PlannerInput = {
  task: string;
  observation: Observation;
  policy: ActionPolicy;  // ← Expected
  history: Step[];
  remainingSteps: number;
};

// Actual kernel:
type PlannerInput = {
  task: string;
  observation: Observation;
  history: Step[];
  remainingSteps: number;
  defaultUrl?: string;  // ← No policy
};
```

Policy is not passed to planner. This means:

⚠️ **Planner doesn't know what's allowed** (policy is only enforced by validateAction)
✅ **Validation happens at kernel level** (separate concern)

**Impact on PR #7 design:**
- Planner can't optimize based on policy (e.g., "no destructive actions")
- But validation still prevents policy violations
- For CLI, this is fine (planner is trusted, validation is second layer)

---

### Gap #6: Observation Staleness Detection

**Problem:**
```typescript
// PR #7 sketch assumed:
type Target = {
  observationId: string;
  elementId: string;
};

// Actual kernel has exactly this:
type Target = {
  observationId: string;
  elementId: string;
};
```

Actually, this is ALIGNED! ✅

The kernel already tracks observationId in targets and validates staleness:
```typescript
// From actions.ts
if (action.target.observationId !== observation.id) {
  throw new Error(`Action target was planned from stale observation...`);
}
```

---

## Contract Audit Verdict

### Can PR #7 CLI Scenario Work? ✅ YES

The actual PR #5 kernel **is sufficient for the CLI scenario**, despite the gaps.

**Why the gaps don't block CLI:**
1. ✅ CLI has Playwright.Page available (not browser-local)
2. ✅ Observation function works with Playwright
3. ✅ Planner returns BrowserAction (metadata tracking is separate concern)
4. ✅ Success/failure is enough for MVP (rejection vs failure not critical yet)
5. ✅ Policy enforcement works at validation layer

### What's Blocked?

**Browser-local mode sharing the real kernel is partially blocked:**
- Executor interface requires Playwright.Page (can't use in browser)
- Observation function requires Playwright (can't use in browser)
- Would need wrapper interfaces or different executor paths for browser-local

**This is important discovery:** The actual PR #5 kernel, while portable at the *semantic* level (no host assumptions in state machine), has *interface* assumptions about Playwright being present.

---

## Recommendations for PR #8

### For CLI Implementation (Primary)

1. **Use actual kernel as-is**
   - `Planner.next()` interface works fine
   - `BrowserExecutor.execute()` with Playwright works fine
   - `observe()` function works fine
   - Validation layer handles policy

2. **Track metadata separately**
   - Capture LLM model and tokens outside planner response
   - Store in TaskResult.telemetry
   - Don't force changes to Planner interface

3. **Handle no-rejection gracefully**
   - Accept failure as outcome for unsupported actions
   - Planner will learn to avoid what fails
   - MVP doesn't need sophisticated rejection

### For Browser-Local Mode (Secondary)

**Critical finding:** The actual kernel interfaces are **not fully portable** to browser execution.

Options:
1. **Create wrapper adapters** (still use actual kernel)
   - Implement browser-local Planner wrapper
   - Implement browser-local BrowserExecutor wrapper
   - Adapters translate between browser environment and kernel interfaces

2. **Create separate browser-local entry point** (uses actual kernel, different adapters)
   - `apps/web/src/main.ts` doesn't use core kernel's executor
   - Brings its own observation and execution logic
   - Still uses core kernel's semantic layer (state machine, policy)

3. **Defer browser-local to PR #9**
   - PR #8 builds CLI with real kernel
   - PR #9 revisits browser-local with wrapper pattern
   - Both use same kernel semantic core

### Recommended Path

**PR #8:** Build CLI using actual PR #5 kernel as-is
- No kernel changes needed
- All interfaces align for Node.js + Playwright
- TaskResult is sufficient for evidence
- Planner metadata tracking works with current telemetry

**PR #9 or PR #9-alt:** Revisit browser-local with adapter wrappers
- Create browser-local Planner wrapper
- Create browser-local BrowserExecutor wrapper
- Share kernel semantic core with CLI
- Document why interfaces differ (Playwright.Page dependency)

---

## Contract Audit Summary

| Contract | Gap Severity | Impact | Resolution |
|----------|-------------|--------|-----------|
| Planner interface | ⚠️ Minor | No per-call metadata | Track separately in telemetry |
| BrowserExecutor interface | 🔴 Major | Requires Playwright.Page | CLI OK; browser-local needs wrapper |
| Observation function | 🔴 Major | Requires Playwright | CLI OK; browser-local needs wrapper |
| TaskResult format | ⚠️ Minor | No deploymentMode field | Add if needed; not critical for MVP |
| Action "rejected" status | ⚠️ Minor | Only success/failure | Works for MVP; revisit for negotiation |
| Policy in planner input | ⚠️ Minor | Not passed to planner | Validation layer sufficient |
| Observation staleness | ✅ Aligned | Already implemented | No changes needed |

**Overall:** ✅ **Kernel is suitable for CLI implementation (PR #8).**

**But:** 🔴 **Browser-local needs separate adapter layer (PR #9).**

The original vision of "same kernel, same adapters, different modes" needs refinement:
- Same kernel ✅
- Playwright.Page dependency means different adapters for CLI vs browser ⚠️
- Browser-local adapters as a separate pattern ⚠️

---

## Next Steps

1. **Approve PR #7** with this audit attached (architecture decision spike is sound)
2. **Plan PR #8** to build CLI using actual kernel (no kernel changes needed)
3. **Document for PR #9** that browser-local requires adapter wrappers (not in scope for #8)
