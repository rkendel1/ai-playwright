# Execution Architecture Design

## Overview

This document captures the architectural decisions and designs required to deliver `npx runora` as a developer-friendly CLI tool that runs browser-based test automation.

The architecture must support:
1. **Developer CLI** (primary): Simple `npx runora --url <app> --task <goal>` interface
2. **Browser-local web app** (secondary): Self-hosted browser testing (PR #6 proved feasibility)
3. **Unified kernel**: Same aipw-core, same message contracts, different adapters per mode

---

## Part 1: External Runtime Architecture

### CLI Entry Point

```typescript
// packages/cli/index.ts
// Pseudocode; not production

import { spawnBrowser } from "./browser-lifecycle";
import { runKernel } from "@aipw/core";
import { RemotePlannerAdapter } from "./adapters/remote-planner";
import { PlaywrightBrowserAdapter } from "./adapters/playwright-browser";

async function main(args: string[]) {
  // Parse: npx runora --url http://localhost:3000 "test checkout"
  const { url, task, model = "gpt-4o-mini" } = parseArgs(args);

  // Launch isolated browser instance
  const browser = await spawnBrowser({ headless: true });
  const page = await browser.newPage();

  try {
    // Set up adapters for external runtime mode
    const planner = new RemotePlannerAdapter(model);
    const executor = new PlaywrightBrowserAdapter(page);

    // Run kernel with external adapters
    const result = await runKernel({
      task: { id: uuid(), goal: task },
      planner,
      executor,
      maxSteps: 50,
      maxTimeMs: 300_000,
    });

    // Report evidence
    console.log(formatEvidence(result));

    process.exit(result.status === "passed" ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main(process.argv.slice(2)).catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

### Browser Lifecycle Management

The CLI owns browser lifetime:
- Launch: Isolated Chromium instance (headless by default)
- Navigation: Kernel never navigates; dev specifies target URL at start
- Shutdown: CLI closes browser when kernel exits or times out
- Error handling: Playwright exceptions wrapped as user-friendly messages

**Design constraint:** Kernel never calls Playwright directly. Browser adapter abstracts it.

### Adapter Contract: Remote Planner

```typescript
// packages/cli/adapters/remote-planner.ts
// Pseudocode

export class RemotePlannerAdapter implements PlannerAdapter {
  constructor(private model: string) {}

  async plan(request: PlannerRequest): Promise<PlannerResponse> {
    // Convert kernel request to API call
    const prompt = generatePrompt(request);

    // Call external LLM API (OpenAI, Anthropic, Groq, etc.)
    const response = await fetch("https://api.openai.com/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    // Parse response into kernel action
    const action = parseAction(data.choices[0].message.content);

    return {
      action,
      metadata: { model: this.model, tokens: data.usage },
    };
  }
}
```

**Contract:**
- Input: `PlannerRequest` (task, observation, policy, history, remaining steps)
- Output: `PlannerResponse` (action, optional metadata)
- Same message format as browser-local mode (PR #6)
- Kernel never knows about API keys, models, or LLM provider

### Adapter Contract: Playwright Browser

```typescript
// packages/cli/adapters/playwright-browser.ts
// Pseudocode

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  constructor(private page: Page) {}

  async observe(): Promise<Observation> {
    // Capture current browser state
    const url = this.page.url();
    const title = await this.page.title();
    const text = await this.page.textContent("body");
    const elements = await this.page.evaluate(() => {
      // Find interactable elements: buttons, inputs, links, etc.
      return Array.from(document.querySelectorAll("button, input, a, [role=button]"))
        .map(el => ({
          id: generateElementId(el),
          selector: generateSelector(el),
          tag: el.tagName,
          text: el.textContent?.trim() || "",
          visible: isVisible(el),
          enabled: !el.hasAttribute("disabled"),
        }));
    });

    return {
      id: observationId(`obs-${Date.now()}`),
      timestamp: Date.now(),
      url,
      title,
      text,
      elements,
    };
  }

  async execute(request: BrowserRequest): Promise<BrowserResponse> {
    const { action, observationId } = request;

    try {
      switch (action.type) {
        case "click": {
          const selector = resolveSelector(action.target);
          await this.page.click(selector);
          break;
        }
        case "fill": {
          const selector = resolveSelector(action.target);
          await this.page.fill(selector, action.value);
          break;
        }
        case "assert": {
          const found = await this.page.evaluate((query) => {
            return document.body.textContent?.includes(query) ?? false;
          }, action.assertion.text);
          if (!found) throw new Error(`Assertion failed: ${action.assertion.text}`);
          break;
        }
        case "navigate": {
          await this.page.goto(action.url, { waitUntil: "networkidle" });
          break;
        }
      }

      return { result: { status: "success" } };
    } catch (error) {
      return {
        result: { status: "failed", reason: error.message },
      };
    }
  }
}
```

**Contract:**
- Input: `BrowserRequest` (action, observationId)
- Output: `BrowserResponse` (result, optional observation)
- Same message format as browser-local mode
- Adapts Playwright API calls to kernel action semantics
- Kernel never calls Playwright directly

---

## Part 2: Browser-Local Architecture (Secondary)

Reuses the same kernel and message contracts. Different adapters:

```typescript
// apps/web/src/main.ts (from PR #6)
// Simplified sketch

export class WebLLMPlannerAdapter implements PlannerAdapter {
  async plan(request: PlannerRequest): Promise<PlannerResponse> {
    // Load WebLLM model (or mock for now)
    const model = new WebLLM("Llama-2-7b");
    const prompt = generatePrompt(request);

    const output = await model.generate(prompt);
    const action = parseAction(output);

    return { action, metadata: { model: "webllm" } };
  }
}

export class DOMBrowserAdapter implements BrowserAdapter {
  async observe(): Promise<Observation> {
    // Capture current DOM state (same as Playwright version)
    return {
      id: observationId(`obs-${Date.now()}`),
      url: window.location.href,
      title: document.title,
      text: document.body.textContent || "",
      elements: Array.from(document.querySelectorAll("button, input, a")).map(/*...*/),
    };
  }

  async execute(request: BrowserRequest): Promise<BrowserResponse> {
    // Execute on DOM (no Playwright; just native browser APIs)
    const { action } = request;
    switch (action.type) {
      case "click":
        document.querySelector(action.target.selector)?.click();
        break;
      case "fill":
        (document.querySelector(action.target.selector) as HTMLInputElement).value =
          action.value;
        break;
      // ... etc
    }
    return { result: { status: "success" } };
  }
}
```

**Key difference:** Same kernel, same message contract, different runtime environment.

---

## Part 3: Capability Negotiation

### Gate 2 Analysis: Do We Need It?

**Current assumption:** Both modes support:
- Click, fill, assert, navigate (core actions)
- Observation capture (DOM state)
- Policy validation (approval levels)

**Actions that differ:**

| Action | CLI (Playwright) | Browser-Local (DOM) | Negotiation? |
|--------|------------------|--------------------|------------|
| Click  | ✓                | ✓                  | No         |
| Fill   | ✓                | ✓                  | No         |
| Assert | ✓                | ✓                  | No         |
| Navigate | ✓              | ✓                  | No         |
| Screenshot | ✓ (Playwright) | ✗ (no canvas pixels) | **Yes?** |
| JavaScript execute | ✓ (Playwright) | ✓ (eval) | No |
| Network spy | ✓ (CDP) | ✗ | **Yes?** |
| Download file | ✓ (Playwright) | ✗ (security) | **Yes?** |

### Proposed Capability Negotiation

If the kernel encounters an action it doesn't know how to execute:

**Option A: Reject at validation time**
- Executor's `execute()` returns `{result: {status: "rejected", reason: "not_supported"}}`
- Kernel treats rejection as BLOCKED (policy/executor constraint, not failure)
- Planner learns from trace that action was rejected; plans differently

```typescript
async execute(request: BrowserRequest): Promise<BrowserResponse> {
  if (action.type === "screenshot" && !this.capabilities.screenshot) {
    return {
      result: {
        status: "rejected",
        reason: "screenshot not supported in browser-local mode",
      },
    };
  }
  // ...
}
```

**Option B: Handshake before task**
- CLI calls `executor.getCapabilities()` before kernel starts
- Kernel learns what's available upfront
- Can adjust task or reject incompatible goals

```typescript
interface BrowserAdapter {
  observe(): Promise<Observation>;
  execute(request: BrowserRequest): Promise<BrowserResponse>;
  getCapabilities?(): Promise<{
    screenshot: boolean;
    networkSpy: boolean;
    downloadFile: boolean;
    // ...
  }>;
}
```

### Decision: Option A (Runtime Rejection)

**Rationale:**
- Simpler: No handshake needed
- More robust: Planner can adapt if action is rejected
- Kernel already handles rejection (maps to BLOCKED state)
- Traces are portable (rejection is visible in trace, can be replayed with fallback)

**Constraint:** Kernel must document that executor rejection is valid terminal state (not error).

---

## Part 4: Trace and Evidence Format

### TaskResult Structure

Same structure across all modes:

```typescript
interface TaskResult {
  id: TaskId;
  status: "passed" | "failed" | "blocked";
  goal: string;
  steps: Step[];
  evidence: {
    initialState: Observation;
    finalState: Observation;
    actionSequence: Array<{ action: BrowserAction; result: "success" | "rejected" | "failed" }>;
    duration: number; // milliseconds
  };
  telemetry: {
    observationCount: number;
    inferenceCount: number;
    validationCount: number;
    executionCount: number;
    totalTokens?: { in: number; out: number }; // LLM tokens
  };
  deploymentMode?: "cli" | "browser-local"; // Informational, not required
}
```

### Evidence Format for CI/CD

Suitable for GitHub Actions, GitLab CI, or other test reporters:

```json
{
  "taskId": "task-abc123",
  "status": "passed",
  "goal": "test checkout",
  "duration": 4532,
  "actionSequence": [
    { "action": "navigate", "target": "http://localhost:3000", "status": "success" },
    { "action": "click", "target": "button#products", "status": "success" },
    { "action": "fill", "target": "input[data-testid=search]", "value": "shirt", "status": "success" },
    { "action": "assert", "assertion": "Shirt found", "status": "success" },
    { "action": "click", "target": "button#checkout", "status": "success" },
    { "action": "fill", "target": "input[data-testid=email]", "value": "test@example.com", "status": "success" },
    { "action": "assert", "assertion": "Order confirmed", "status": "success" }
  ],
  "initialState": {
    "url": "http://localhost:3000",
    "title": "Online Store",
    "visibleText": "Welcome to our store"
  },
  "finalState": {
    "url": "http://localhost:3000/order/12345",
    "title": "Order Confirmation",
    "visibleText": "Order #12345 confirmed"
  }
}
```

### CLI Output Format

```bash
$ npx runora --url http://localhost:3000 "test checkout"

🔍 Connecting to http://localhost:3000...
✓ Page loaded (title: Online Store)

🤖 Planning... (gpt-4o-mini)
→ Action: navigate to /products

⚙️  Executing... 
✓ Click completed

🤖 Planning...
→ Action: fill search box with "shirt"

⚙️  Executing...
✓ Fill completed

...

✅ PASSED (4.5s)

Evidence: task-abc123.json
Summary: 7 actions, 2 assertions, all passed
```

---

## Part 5: Decision Matrix

### Gate 1: Abstraction Sufficiency for External Runtime

**Question:** Can kernel + adapters work for CLI mode (external LLM + Playwright)?

**Evidence:**
- ✓ External runtime uses identical `PlannerRequest` / `PlannerResponse` contract
- ✓ External runtime uses identical `BrowserRequest` / `BrowserResponse` contract
- ✓ Kernel makes no mode-specific assumptions (verified in PR #5)
- ✓ CLI sketches (pseudocode above) map cleanly to adapter interfaces
- ✓ Browser lifecycle is adapter's concern, not kernel's

**Decision:** ✅ **PASS**

**Implications for PR #8:** Can proceed with CLI implementation using same kernel and adapters.

---

### Gate 2: Capability Negotiation

**Question:** If modes differ in capabilities, is runtime rejection sufficient?

**Evidence:**
- ✓ Current action schema (click, fill, assert, navigate) supported by both modes
- ✓ Differing actions (screenshot, network spy) are optional enhancements
- ✓ Kernel already handles executor rejection → BLOCKED state
- ✓ Planner learns from rejection in trace; can plan differently
- ✓ No handshake needed; keeps architecture simple

**Design:** Runtime rejection via `{result: {status: "rejected", reason: "..."}}` in executor response.

**Decision:** ✅ **PASS**

**Implications for PR #8:** Executor rejection maps cleanly to BLOCKED state. No capability negotiation protocol needed for MVP. Can be added later if richer capabilities require it.

---

### Gate 3: Developer Experience Without Tool Exposure

**Question:** Can CLI hide Playwright/Obscura complexity?

**Evidence:**
- ✓ CLI entry point is simple: `npx runora --url <app> --task <goal>`
- ✓ Browser lifecycle (launch/shutdown) is CLI's responsibility, not kernel's
- ✓ Playwright exceptions wrapped as user-friendly messages
- ✓ Model selection is optional (sensible default)
- ✓ Evidence JSON is available but not required to understand result

**Design:**
```bash
# Works out of the box (with sensible defaults)
npx runora "test checkout"  # Uses http://localhost:3000 as default
npx runora --url http://localhost:3000 "test checkout"

# Optional: customize
npx runora --url http://localhost:3000 --task "test checkout" --model gpt-4

# Never expose:
# ❌ Playwright API
# ❌ CDP configuration
# ❌ Obscura setup
# ❌ Browser launch args
```

**Decision:** ✅ **PASS**

**Implications for PR #8:** CLI design is achievable. Browser lifecycle management and error wrapping are standard practices. No architectural blocker.

---

### Gate 4: Trace and Evidence Format

**Question:** Is TaskResult suitable as canonical output across all modes?

**Evidence:**
- ✓ TaskResult structure is deployment-mode agnostic (no CLI-specific fields)
- ✓ Evidence includes initial/final state, action sequence, duration
- ✓ Telemetry is comparable (observation count, inference count, token counts for LLM)
- ✓ Trace can be serialized to JSON (proven in PR #5 message boundary test)
- ✓ CI/CD integration needs only status, duration, action sequence (all present)

**Design:** TaskResult as above. CI/CD tools can parse JSON or consume CLI exit code + stdout.

**Decision:** ✅ **PASS**

**Implications for PR #8:** TaskResult is suitable for shipping. No format changes needed.

---

## Summary

| Gate | Decision | Blocker? | Notes |
|------|----------|----------|-------|
| **Gate 1: Abstraction** | ✅ PASS | No | Kernel + adapters work for CLI |
| **Gate 2: Capability Negotiation** | ✅ PASS | No | Runtime rejection is sufficient |
| **Gate 3: Developer Experience** | ✅ PASS | No | CLI design hides Playwright complexity |
| **Gate 4: Trace/Evidence** | ✅ PASS | No | TaskResult is canonical across modes |

**Overall:** ✅ **ARCHITECTURE DECISION PASSED**

PR #8 can proceed with CLI implementation. No kernel changes needed. No architectural blockers identified.

---

## Part 6: What PR #8 Builds

Based on all gates passing and contract audit confirming feasibility:

**PR #8: CLI Implementation**
- `packages/cli/index.ts` — Full CLI entry point (based on index-sketch.ts)
- `packages/cli/adapters/remote-planner.ts` — External LLM wrapper (OpenAI, Anthropic, etc.)
  - Implements `Planner` interface from actual PR #5 kernel
  - Wraps `Planner.next(input)` to call external LLM API
  - Returns `BrowserAction`
- `packages/cli/browser-lifecycle.ts` — Browser spawn/shutdown
  - Manages Playwright browser lifetime
  - Provides `BrowserRuntime` interface or similar
- `packages/cli/evidence-reporter.ts` — JSON + human-readable output
  - Formats TaskResult for CI/CD
  - CLI summary output
- Tests: End-to-end CLI tests with mock LLM + Playwright

**Important:** Uses actual PR #5 kernel interfaces as-is
- No kernel changes needed
- No wrapper layer for planner/executor (they work directly with Playwright)
- TaskResult format unchanged

**Prerequisite:** PR #6 must be merged (browser-local feasibility proved).

---

## Part 7: Browser-Local (PR #9 or PR #9-alt)

**Contract audit finding:** The actual PR #5 kernel has interface-level Playwright dependencies, even though the semantic core is portable.

**Solution:** Adapter wrapper pattern for browser-local

```typescript
// Browser-local needs wrapper adapters to use the same kernel
// BUT: These adapters wrap the kernel's semantic core, not fork it

interface BrowserLocalPlannerAdapter implements Planner {
  next(input: PlannerInput): Promise<BrowserAction> {
    // Use WebLLM (or mock) to generate action
    // Return BrowserAction same as any other Planner
  }
}

interface BrowserLocalBrowserExecutor implements BrowserExecutor {
  execute(page: Page, action: BrowserAction, obs: Observation): Promise<ActionResult> {
    // Execute on actual DOM (not Playwright)
    // But page parameter is unused (only in Node.js, not browser anyway)
    // Return ActionResult same as PlaywrightExecutor
  }
}
```

**Key insight:** Both modes implement the *same interfaces*, but CLI uses Playwright implementations while browser-local would use DOM/WebLLM implementations. The kernel doesn't care which implementation; it only knows the interface.

This validates the architecture: **"same kernel, different adapters"** is achievable, but the adapter implementations differ by target environment.

---

## Part 8: Architecture Refined

Original architecture was correct; contract audit refines the implementation story:

```
                 Runora
                      │
                ┌─────▼─────┐
                │ aipw-core │
                └─────┬─────┘
                      │
             ┌────────┴────────┐
             │                 │
        Developer CLI      Browser Web App
        PRIMARY            SECONDARY
             │
    ┌────────┴────────┐
    │                 │
 [Planner]        [BrowserExecutor]
    │                 │
    ├─ RemoteLLM      ├─ PlaywrightBrowser  (PR #8 CLI)
    │  (PR #8)        │  (PR #8)
    │
    ├─ WebLLM         ├─ DOMBrowser         (PR #9 browser-local)
    │  (PR #9)        │  (PR #9)
```

**Both modes use same kernel; adapters differ by target runtime.**

---

## References

- PR #5: Portable kernel (message contracts, state machine)
- PR #6: Browser-local feasibility (DOM adapter proof)
- PR #7: Execution architecture design (this document + spike)
- PR #8: CLI implementation (once this spike is approved)
