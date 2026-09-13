# PR #8: Real Developer CLI Implementation

## Objective

Implement the CLI vertical slice that proves browser-based automation works end-to-end for the developer:

```bash
$ npx ai-playwright --url http://127.0.0.1:3000 "test checkout"
```

Expected experience:
```
AI Playwright
Target:  http://127.0.0.1:3000
Task:    test checkout
Browser: Obscura

✓ Navigate
✓ Observe
✓ Plan action
✓ Execute
✓ Assert

PASS (4.2s)
Evidence: .ai-playwright-results/task-abc123.json
```

**Acceptance criterion:** Developer runs CLI against local app and gets deterministic PASS/FAIL + inspectable evidence, without needing to know Playwright, CDP, or Obscura exist.

---

## Scope: What PR #8 Builds

### 1. CLI Entry Point
- `packages/cli/index.ts` (real, executable code)
- Argument parsing: `--url`, `--task`
- Browser launch via **real Playwright + Obscura** (proven in PR #4)
- Parse task from positional argument or `--task` flag
- Call `aipw-core` kernel with deterministic Planner + real BrowserExecutor
- Output result to console + JSON file

### 2. Planner Adapter (Deterministic for PR #8)
- `packages/cli/adapters/planner.ts`
- Implements `Planner` interface from `@aipw/core`
- **PR #8 uses a deterministic/minimal planner** (not WebLLM, not remote LLM)
  - Parse task as simple steps (navigate, click, fill, assert)
  - Generate predictable action sequence
  - Serve as proof-of-concept for adapter contract
- **PR #9 will swap this with WebLLM** without changing CLI or kernel
- Return `BrowserAction` matching kernel expectations

### 3. Result Formatter
- `packages/cli/evidence-reporter.ts`
- Accepts `TaskResult` from kernel
- Output to console (human-readable summary)
- Write JSON to `.ai-playwright-results/<timestamp>.json`
- Exit code: 0 (passed), 1 (failed/blocked)

### 4. Package Metadata
- Update `package.json` CLI binary entry: `"aipw": "packages/cli/index.ts"`
- Create `packages/cli/package.json` if separate workspaces
- Document: `npx ai-playwright --help`

### 5. Integration Tests (Minimal)
- Test with mock Planner + real Playwright
- Test with real Playwright against local fixture app (same from PR #6)
- Verify TaskResult structure
- Verify exit codes

---

## Scope: What PR #8 Does NOT Build

### Explicitly Deferred to PR #9+

❌ **Real Planner (WebLLM)**
- PR #8 uses deterministic/minimal planner for proof-of-concept
- PR #9 replaces planner with WebLLM (same CLI, same kernel, different adapter)
- This keeps the progression clean and obvious

❌ **Browser-Local Execution**
- PR #8 proves CLI with real Playwright + Obscura (from PR #4)
- Browser-local requires separate DOM adapter (PR #9-alt or later)

❌ **Capability Negotiation**
- Not needed for MVP
- Planner learns from failures
- Defer if contract doesn't expose the need

❌ **Model Configuration UI**
- Accept API key from environment only
- CLI flag for model selection is optional (default works)
- Don't add config files, environment setup automation, etc.

❌ **MCP or Plugin Ecosystem**
- Not in scope
- Focus on vertical slice, not extensibility

❌ **Autonomous Loops**
- Not in scope
- Kernel already handles looping; CLI just calls `.task()`

❌ **Sophisticated Evidence Infrastructure**
- TaskResult + JSON dump is sufficient
- Don't add JUnit reporters, HTML dashboards, etc.
- Just JSON (machine-readable) + text summary (human-readable)

❌ **New Kernel Abstractions**
- Use PR #5 kernel as-is
- No changes to `Planner`, `BrowserExecutor`, `TaskResult`
- If implementation exposes a gap, audit the contract rather than change kernel

❌ **Browser Lifecycle Choreography**
- Use simple Playwright lifecycle (launch → page → close)
- No multi-browser management
- No session reuse between tasks

---

## Implementation Contract (PR #7 Freeze)

### Do Not Change

**Kernel Interfaces:**
- `Planner { next(input: PlannerInput): Promise<BrowserAction> }`
- `BrowserExecutor { execute(page: Page, action: BrowserAction, obs: Observation): Promise<ActionResult> }`
- `TaskResult` (same structure from PR #5)

**Adapter Boundary:**
- Runtime concerns (Playwright, API keys, model selection) live in adapters
- Kernel owns state machine, validation, trace
- Adapters own environment-specific logic

**CLI Scenario:**
- Primary: `npx ai-playwright --url http://localhost:3000 "test checkout"`
- No more, no less for MVP

### If Implementation Hits a Gap

**Decision tree:**
1. Gap in kernel interface? → Stop, audit contract (don't add abstraction)
2. Gap in evidence format? → Add to TaskResult only if universal need proven
3. Gap in Planner response? → Track in telemetry, don't change interface
4. Gap that requires new kernel concept? → Raise in PR review, defer to PR #9+

**Example:** If real LLM tokens aren't accessible through `Planner` interface:
- ❌ Don't add metadata field to `PlannerResponse`
- ✅ Do track separately in telemetry or CLI wrapper
- 📋 Do document finding for future audits

---

## Definition of Done

### Code
- [ ] `packages/cli/index.ts` executable end-to-end
- [ ] `packages/cli/adapters/remote-planner.ts` wraps external LLM
- [ ] `packages/cli/evidence-reporter.ts` formats output
- [ ] `npx ai-playwright --help` works
- [ ] Exit codes correct (0 = passed, 1 = failed/blocked)

### Testing
- [ ] E2E test: CLI against fixture app with mock Planner
- [ ] E2E test: CLI against fixture app with real Planner (mock LLM response)
- [ ] TaskResult structure validated (JSON serialization works)
- [ ] Evidence file created at expected path

### Documentation
- [ ] README in `packages/cli/` with quick start (5 min)
- [ ] Usage: `npx ai-playwright --url <app> "<task>"`
- [ ] Example: `npx ai-playwright --url http://localhost:3000 "test checkout"`

### Developer Experience
- [ ] Can clone, npm install, run without Playwright knowledge
- [ ] Error messages are friendly (no Playwright stack traces)
- [ ] PASS/FAIL is the headline, evidence is secondary
- [ ] Works without API key for mock mode

---

## Acceptance Gate

The PR is done when a developer (or reviewer without Playwright background) can:

1. Clone repo
2. `npm install`
3. `npx ai-playwright --url http://localhost:3000 "test checkout"`
4. Get deterministic PASS/FAIL + JSON evidence
5. Understand what happened without documentation

**Success:** CLI is self-documenting and requires no platform knowledge.

**Failure:** If reviewer asks "how does this work?" or "what's a Playwright?", the CLI isn't ready.

---

## Files Changed

```
packages/
  cli/
    package.json          (new; if separate workspace)
    index.ts              (new; CLI entry point)
    adapters/
      remote-planner.ts   (new; external LLM wrapper)
    evidence-reporter.ts  (new; output formatting)
    __tests__/
      cli.test.ts         (new; E2E tests)

package.json
  (update bin.aipw to point to packages/cli/index.ts)

docs/
  PR_8_CLI_IMPLEMENTATION.md (this file)
```

---

## What Success Looks Like

```
$ npx ai-playwright --url http://127.0.0.1:3000 "test checkout"

AI Playwright
Target:  http://127.0.0.1:3000
Task:    test checkout
Browser: Obscura

✓ Observe page
✓ Plan next step (navigate)
✓ Execute (goto http://127.0.0.1:3000/checkout)
✓ Observe page
✓ Plan next step (click)
✓ Execute (click Add Item)
✓ Plan next step (fill)
✓ Execute (fill email)
✓ Plan next step (assert)
✓ Assert "Order confirmed" ✓

PASSED (3.2s)

Evidence: .ai-playwright-results/2026-09-13T15-45-30-123Z.json

$ cat .ai-playwright-results/2026-09-13T15-45-30-123Z.json | jq .status
"passed"
```

**Key:** Developer doesn't need to know about Playwright, Obscura, or the kernel. Just runs CLI and gets PASS/FAIL.

---

## Not in Scope (Explicitly Deferred)

The following are **not** PR #8 work. If they come up, defer to PR #9+:

- [ ] WebLLM integration (browser-local requires separate adapters)
- [ ] Model fine-tuning or prompt engineering
- [ ] Autonomous agent loops
- [ ] CI/CD plugins or GitHub Actions integration
- [ ] Performance optimization
- [ ] Multi-browser support (Firefox, Safari later)
- [ ] Visual regression testing
- [ ] Network interception
- [ ] Video/screenshot recording
- [ ] Session reuse between tasks
- [ ] Credential management
- [ ] Advanced error recovery
- [ ] Capability negotiation protocol

---

## Timeline

- Implementation: 1-2 days (focused vertical slice)
- Testing: 0.5-1 day
- Documentation: 0.5 day
- **Total: 2-4 days**

---

## References

- PR #4: Runtime proof (demonstrates kernel works with Playwright)
- PR #5: Portable kernel (kernel interfaces + state machine)
- PR #6: Browser-local feasibility (proves kernel can run in browser)
- PR #7: Execution architecture (decision spike + contract audit)
- **PR #8: This document (real CLI implementation)**

---

## Clean Progression: PR #8 → PR #9

### PR #8 (This PR)
```
CLI
  ↓
parse --url + task
  ↓
Deterministic Planner (proof-of-concept)
  ↓
aipw-core Kernel
  ↓
Real Playwright + Obscura (from PR #4)
  ↓
Real browser at localhost:3000
  ↓
PASS/FAIL + evidence
```

### PR #9 (Next: Swap Planner)
```
CLI (unchanged)
  ↓
parse --url + task
  ↓
WebLLM Planner (replaces deterministic)
  ↓
aipw-core Kernel (unchanged)
  ↓
Real Playwright + Obscura (unchanged)
  ↓
Real browser at localhost:3000 (unchanged)
  ↓
PASS/FAIL + evidence (unchanged)
```

**Key insight:** PR #9 is just `packages/cli/adapters/planner.ts` using WebLLM instead of deterministic logic. Everything else stays the same. This keeps the progression obvious and prevents scope creep.

## Next Steps After PR #8

### If CLI Works
- Merge PR #8
- Prove proof-of-concept works
- PR #9 swaps in WebLLM (single adapter change)

### If CLI Exposes Architectural Friction
- Document the exact friction
- Audit whether it's a kernel contract issue or implementation issue
- Stop and resolve before continuing (don't add workarounds)
- Report findings; don't speculatively expand

### Future (PR #9+)
- PR #9: Real WebLLM planner (adapter swap only)
- PR #10: Browser-local adapter (if still needed after dogfood)
- PR #11+: Performance, extended actions, CI/CD integration

But those are downstream. PR #8 is about proving the core CLI + real browser scenario works with deterministic logic.
