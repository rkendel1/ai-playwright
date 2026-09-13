# Execution Architecture Decision Spike (PR #7)

## Primary Developer Scenario

The canonical acceptance scenario drives all architectural decisions:

```bash
$ npx ai-playwright "test checkout"

→ Launches isolated browser via Playwright
→ Connects to local test app at http://127.0.0.1:3000
→ Accepts natural-language task
→ aipw-core kernel runs task with external planner + executor
→ Returns PASS/FAIL + evidence trace
```

This scenario must work without the developer understanding Playwright, Obscura, CDP, or model configuration.

## Architecture Hierarchy

```
                 AI Playwright
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
       ┌─────┴─────┐
       ▼           ▼
    Planner     Executor
       │           │
    WebLLM      Playwright
    (future)        │
                 Obscura
```

**Developer CLI (Primary):** `npx ai-playwright --url <app> --task <goal>`
- Orchestrates browser lifecycle
- Runs aipw-core with external execution
- Returns evidence and result
- No dev should touch Playwright/Obscura/CDP directly

**Browser Web App (Secondary):** `npm run web:dev` for self-hosted testing
- Proves browser-local kernel (PR #6 finding)
- Optional deployment mode
- Does not dictate primary product architecture

## Objective

Determine whether the portable kernel abstraction (PR #5) can serve as the core of a developer-friendly CLI tool that orchestrates browser-based test automation.

**Critical principle:** This spike answers *architectural* questions through evidence and design, not implementation. We document the path to "npx ai-playwright" working end-to-end, but don't build it yet—only the decision layer.

---

## Decision Gates

### Gate 1: Abstraction Sufficiency for External Runtime

**Question:** Can the same `Kernel` + `PlannerAdapter` + `BrowserAdapter` interfaces work for the developer CLI scenario where:
- PlannerAdapter = external LLM (Groq, Anthropic API, or local inference)
- BrowserAdapter = Playwright + Obscura orchestration

**What we're testing:**
- External runtime mode: Remote LLM API + Playwright execution adapter
- Same kernel, different deployment than PR #6's browser-local
- CLI produces same trace format as web app
- Message contracts remain stable across both modes

**Success criteria:**
- External runtime uses identical `PlannerRequest` / `PlannerResponse` messages
- External runtime uses identical `BrowserRequest` / `BrowserResponse` messages
- Kernel makes zero assumptions about which mode is running
- No mode-specific code paths in kernel
- Developer CLI can produce evidence trace identical to browser-local trace

**Exit conditions:**
- ✓ PASS: External runtime feasible; kernel is genuinely mode-agnostic
- ✗ FAIL: Fundamental incompatibility (kernel needs browser guarantees external can't provide)
- ⊘ BLOCKED: Abstraction works but requires capability negotiation (Gate 2)

---

### Gate 2: Capability Negotiation for Cross-Mode Tasks

**Question:** If browser-local can do something (e.g., screenshot) and external runtime can't (or vice versa), how does the kernel handle it safely?

**What we're testing:**
- Different capabilities available in CLI mode vs web app mode
- How kernel learns what executor can do
- Safe action rejection without task failure
- Whether capability negotiation must happen at task start or runtime

**Example scenarios:**

1. Developer runs: `npx ai-playwright --url http://localhost:3000 --task "screenshot the login form"`
   - External runtime (Playwright): CAN take screenshots
   - Browser-local (PR #6): CAN'T take full page screenshots
   - How does kernel know to ask for screenshot only in CLI mode?

2. Developer runs task that clicks button, fills form, submits
   - Both modes support this
   - Easy case; no negotiation needed

3. Developer's trace was created with browser-local; can CLI executor replay it?
   - Trace contains element selectors and coordinates
   - CLI executor must map trace to Playwright equivalents
   - Do traces need capability annotations?

**Exit conditions:**
- ✓ PASS: Capability negotiation model defined and works
- ✗ FAIL: No safe way to express unsupported capabilities
- ⊘ BLOCKED: Requires trace format changes or early capability handshake

---

### Gate 3: Developer Experience Without Tool Exposure

**Question:** Can we hide Playwright, Obscura, CDP, model configuration, and browser lifecycle behind a simple CLI contract?

**What we're testing:**
- CLI package contract (npx ai-playwright)
- Implicit browser launch and shutdown
- Transparent LLM selection (no model API keys exposed)
- Clean error reporting (no Playwright stack traces)
- Evidence trace as first-class output

**Candidate package contracts:**

```bash
# Simplest: infer app from environment
npx ai-playwright "test checkout"

# Explicit: target specific app
npx ai-playwright --url http://localhost:3000 "test checkout"

# Full: all options explicit (but still hidden defaults)
npx ai-playwright --url http://localhost:3000 --task "test checkout" --model gpt-4o

# Never expose:
# ❌ npx ai-playwright --browser-launch-args --cdp --obscura-config --trace-format JSON
```

**Success criteria:**
- No browser lifecycle management visible to dev
- No Playwright exceptions in normal error path
- Task result + evidence is the primary output
- Model selection is optional (sensible default)
- Evidence trace available but not required to understand result

**Exit conditions:**
- ✓ PASS: CLI contract is simple; Playwright/Obscura complexity hidden
- ✗ FAIL: CLI must expose runtime details (not a viable product)
- ⊘ BLOCKED: CLI works but requires extra wrapper or configuration

---

### Gate 4: Trace and Evidence Format

**Question:** Is the TaskResult + evidence trace format suitable as the canonical representation of a test execution across all deployment modes?

**What we're testing:**
- Trace captures both browser-local and CLI execution identically
- Evidence is actionable for debugging
- Trace can be replayed in different mode (CLI trace in browser, or vice versa)
- Evidence format is suitable for CI/CD integration

**Example trace structure:**
```
TaskResult {
  id: "task-abc123"
  status: "PASSED"
  goal: "test checkout"
  trace: [
    { step: 0, phase: "OBSERVE", observationId: "obs-1", duration: 120ms }
    { step: 1, phase: "PLAN", model: "gpt-4o", duration: 850ms, tokens: {in: 400, out: 50} }
    { step: 2, phase: "VALIDATE", policy: "allow", result: "approved", duration: 45ms }
    { step: 3, phase: "EXECUTE", action: {type: "click", selector: "button#checkout"}, duration: 200ms }
    { step: 4, phase: "OBSERVE", observationId: "obs-2", duration: 100ms }
    ...
  ]
  evidence: {
    initialState: { url: "http://localhost:3000", title: "Checkout Page", ... }
    finalState: { url: "http://localhost:3000/success", title: "Order Confirmed", ... }
    actionSequence: ["click checkout", "fill form", "submit"]
  }
  deploymentMode: "external-runtime" | "browser-local"
}
```

**Success criteria:**
- Trace format is deployment-mode agnostic (no CLI-specific fields)
- Evidence includes initial state, action sequence, final state
- Telemetry is comparable across modes (timing, token counts, etc.)
- Trace can be serialized to JSON and replayed

**Exit conditions:**
- ✓ PASS: Trace format works for all modes; evidence is actionable
- ✗ FAIL: Format requires mode-specific interpretation
- ⊘ BLOCKED: Trace works but evidence format needs redesign

---

## Spike Scope

### What We Build (Decision + Design Layer)

1. **`ExecutionArchitectureDesign.md`**
   - Adapter contracts for external runtime (PlannerAdapter using remote LLM, BrowserAdapter using Playwright + Obscura)
   - CLI package contract design (npx ai-playwright interface)
   - Capability negotiation protocol (if Gate 2 requires it)
   - Trace format and evidence structure (if Gate 4 requires refinement)
   - Decision matrix: Gate 1-4 results

2. **CLI package design sketch** (pseudocode, not runnable)
   - Entry point: `packages/cli/index.ts` with argument parsing
   - Browser lifecycle management (launch, shutdown, error handling)
   - External LLM adapter (sketch showing how remote API maps to PlannerAdapter)
   - Playwright executor adapter (sketch showing how Playwright maps to BrowserAdapter)
   - Evidence reporter (JSON output format)

3. **External runtime adapter sketches** (pseudocode)
   - `RemotePlannerAdapter`: Takes HTTP API (e.g., OpenAI), maps to PlannerAdapter contract
   - `PlaywrightBrowserAdapter`: Takes Playwright browser instance, maps to BrowserAdapter contract
   - Both sketches confirm that existing kernel interfaces are sufficient

4. **Trace example** showing CLI execution
   - Real task run in external mode
   - Demonstrates evidence format
   - Shows telemetry capture

5. **Decision matrix** — for each gate, final classification:
   - Gate 1: Abstraction sufficiency → PASS/FAIL/BLOCKED
   - Gate 2: Capability negotiation → PASS/FAIL/BLOCKED + design (if not FAIL)
   - Gate 3: Developer experience → PASS/FAIL/BLOCKED + contract (if not FAIL)
   - Gate 4: Trace/evidence format → PASS/FAIL/BLOCKED + schema (if not FAIL)

### What We Don't Build

- ❌ Real CLI implementation (`npx ai-playwright` doesn't actually work yet)
- ❌ Real external LLM integration (sketch only; don't call OpenAI API)
- ❌ Real Playwright integration (pseudocode only; don't launch browser)
- ❌ Obscura integration (document how it would fit, but don't implement)
- ❌ Model configuration (design the interface, don't build it)
- ❌ Browser lifecycle manager (design it, don't implement)
- ❌ Capability negotiation implementation (design the protocol, don't code it)
- ❌ Any changes to aipw-core kernel (only evaluate whether it needs changes)
- ❌ Tests for external runtime (browser-local was proved in PR #6; external is hypothetical)

### Browser-Local (PR #6) Role

- Remains as **secondary deployment mode** (valuable proof that kernel can run in browser)
- NOT the primary product architecture driver
- May be implemented as PR #8-alt or PR #9-alt after CLI (PR #8) ships
- Serves use cases like in-browser testing frameworks or embedded AI
- Shares same kernel + message contract as CLI mode

---

## Success Criteria

The spike is complete when:

1. **All four gates answered** with clear PASS/FAIL/BLOCKED classification and evidence
2. **ExecutionArchitectureDesign.md** documents:
   - External runtime adapter contracts
   - CLI package interface
   - Capability negotiation (if needed)
   - Trace/evidence format
3. **CLI package sketch** (pseudocode) shows how kernel + adapters integrate
4. **Adapter sketches** show how external LLM + Playwright map to kernel interfaces
5. **Trace example** from external runtime execution
6. **Clear verdict:** Is "npx ai-playwright" architecturally feasible?
   - If yes: PR #8 builds the CLI
   - If blocked: PR #8 solves the blocker
   - If no: requires kernel redesign

## Not Blocking Implementation

If all gates pass, PR #8 can proceed immediately to build the CLI. If gates are blocked, PR #8 still proceeds but with documented constraints. Only a hard FAIL requires root-cause analysis and potential redesign.

## Files to Create

- `docs/ExecutionArchitectureDesign.md` — Decision matrix, adapter contracts, CLI design
- `packages/cli/index.ts` (pseudocode sketch) — CLI entry point and argument parsing
- `packages/cli/adapters-sketch.ts` (pseudocode) — RemotePlannerAdapter + PlaywrightBrowserAdapter sketches
- Optional: Update `packages/core/WASM_KERNEL.md` if kernel changes needed

## Timeline and Effort

- Time estimate: 4-8 hours (decision work + design sketches)
- Effort: Documentation, pseudocode, architectural sketches, examples
- Deliverable: Spec doc + design sketches + decision matrix (no working code)

## Next: PR #8

Once PR #7 is merged with all gates answered:

### If All Gates PASS
- **PR #8:** CLI implementation (npx ai-playwright with external LLM + Playwright)
  - Browser lifecycle management
  - CLI argument parsing
  - Remote LLM adapter (configurable)
  - Evidence reporter
  - Ready to ship as MVP

### If Any Gate BLOCKED (but not FAIL)
- **PR #8:** Solve the blocker(s)
  - Implement capability negotiation (if Gate 2 blocked)
  - Extend CLI interface (if Gate 3 blocked)
  - Refine trace format (if Gate 4 blocked)
- **PR #9:** CLI implementation
- **PR #10:** Optimize or add features

### If Any Gate FAIL
- **Investigation:** Root-cause analysis and document findings
- **Decision:** Kernel redesign, separate runtime per mode, or architectural pivot
- Requires PR #7 addendum with failure analysis before PR #8 starts

---

## References

- PR #4: Runtime proof (Kernel + mock + Playwright + Obscura working together)
- PR #5: Portable kernel (WASM-compatible boundary, zero host dependencies)
- PR #6: Browser-local feasibility (Kernel + DOM, proves browser-local is possible; secondary)
- PR #7: Execution architecture (This spike — design layer; primary focus on CLI)
- PR #8: CLI implementation (once architecture is decided)
- PR #9+: Additional deployment modes (browser-local, CI/CD plugins, etc.)
