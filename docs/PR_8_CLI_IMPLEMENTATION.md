# PR #8: Real Developer CLI Implementation

## Objective

Implement the smallest vertical slice that proves the CLI works end-to-end with a real developer executing:

```bash
$ npx ai-playwright --url http://localhost:3000 "test checkout"
```

Expected output:
```
✅ PASSED (4.2s)
Evidence: .ai-playwright-results/task-abc123.json
```

**Acceptance criterion:** Developer receives deterministic PASS/FAIL result + inspectable JSON trace, with no knowledge of Playwright, Obscura, or the kernel.

---

## Scope: What PR #8 Builds

### 1. CLI Entry Point
- `packages/cli/index.ts` (real, executable code)
- Argument parsing: `--url`, `--task`, optional `--model`
- Browser launch (Playwright chromium, headless by default)
- Parse task from positional argument or `--task` flag
- Call kernel.task() with Planner + BrowserExecutor
- Output result to console + JSON file

### 2. Remote Planner Adapter
- `packages/cli/adapters/remote-planner.ts`
- Implements `Planner` interface from `@aipw/core`
- Maps external LLM (OpenAI, Anthropic, Groq, or mock) to kernel's `Planner.next()`
- Minimal: Accept API key from environment variable
- Default model: `gpt-4o-mini` (cost-effective for development)
- Return `BrowserAction` unchanged

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

### Explicitly Deferred

❌ **WebLLM / Browser-Local**
- Not in scope for PR #8
- Requires separate adapter implementation (PR #9)

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
$ npx ai-playwright --url http://localhost:3000 "test checkout"

🚀 Launching browser...
✓ Page loaded (Checkout Test App)

⚙️  Running task...
  Step 1: Navigate to /checkout
  Step 2: Click "Add Item"
  Step 3: Fill "email" field
  Step 4: Assert "Order confirmed"

✅ PASSED (3.2s)

Evidence: .ai-playwright-results/2026-09-13T15-45-30-123Z.json

$ cat .ai-playwright-results/2026-09-13T15-45-30-123Z.json | jq .status
"passed"
```

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

## Next Steps After PR #8

### If CLI Dogfood Succeeds
- Merge PR #8
- Celebrate proof of concept
- Plan PR #9 based on real developer feedback

### If CLI Exposes Friction
- Document specific friction points
- Audit whether they're contract issues (fix in kernel) or implementation issues (fix in CLI)
- Don't add infrastructure speculatively
- Resolve then continue

### Future (PR #9+)
- Browser-local adapter implementations (if still needed)
- Performance optimizations
- Extended action set (screenshot, network spy, etc.)
- Integration with CI/CD systems
- Multi-language task descriptions

But those are downstream decisions. PR #8 is about proving the core scenario works.
