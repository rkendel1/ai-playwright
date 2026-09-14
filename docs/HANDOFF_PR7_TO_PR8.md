# Handoff: PR #7 Architecture → PR #8 Implementation

## What PR #7 Established

PR #7 is **frozen**. It answers the architectural question:

**Can the same kernel serve both browser-local and CLI deployment modes?**

Answer: ✅ Yes. Verified against actual PR #5 kernel contracts.

### Architecture Proven

```
                aipw-core Kernel
                (PR #5 — unchanged)
                     │
      ┌──────────────┴──────────────┐
      │                             │
   Planner                    BrowserExecutor
      │                             │
  ┌───┴───┐                     ┌───┴────┐
  │       │                     │        │
WebLLM  CLI              Playwright   DOM
(PR #9) (PR #8)          (PR #8)    (PR #9)
```

### Critical Findings

1. **Kernel is semantically portable** (no host assumptions in state machine)
2. **Kernel interfaces are Playwright-aware** (correct—runtime concerns belong in adapters)
3. **Adapters are the adaptation mechanism** (not kernel changes or abstractions)
4. **Dependency direction is crucial** (CLI→adapters→kernel, but kernel knows nothing about CLI/Obscura/CDP)

---

## What PR #8 Must Build

### Scope: Deterministic Planner + Real Browser

Prove this exact vertical slice:

```
CLI argument: --url http://127.0.0.1:3000 "test checkout"
                    ↓
             CLI parser (parse URL + task)
                    ↓
        CliPlannerAdapter (deterministic)
                    ↓
           aipw-core Kernel (real PR #5)
                    ↓
        PlaywrightBrowserExecutor (real PR #5)
                    ↓
        Obscura (from PR #4 — proven to work)
                    ↓
         Real localhost:3000 application
                    ↓
        Independent runtime assertion (e.g., "Order confirmed")
                    ↓
             TaskResult (real PR #5 type)
                    ↓
        Human-readable: ✅ PASSED (3.2s)
        Machine-readable: JSON evidence trace
```

### Files to Create

- `packages/cli/index.ts` — CLI entry point
- `packages/cli/adapters/CliPlannerAdapter.ts` — Deterministic planner (NOT RemotePlannerAdapter)
- `packages/cli/evidence-reporter.ts` — Output formatting
- `packages/cli/__tests__/cli.test.ts` — E2E tests
- Update `package.json` bin entry

### Acceptance Criterion

Command works against a real application:
```bash
npx runora --url http://127.0.0.1:3000 "test checkout"
```

Produces:
- ✅ CLI parses URL + task
- ✅ Deterministic planner generates valid BrowserActions
- ✅ Real PR #5 kernel owns task progression
- ✅ Real Playwright executes actions
- ✅ Obscura connection (no fallback)
- ✅ Target app is exercised
- ✅ Independent assertion determines success
- ✅ PASS/FAIL/BLOCKED result
- ✅ JSON TaskResult emitted
- ❌ No kernel changes
- ❌ No WebLLM
- ❌ No browser-local
- ❌ No MCP/orchestration

### What NOT to Build

**Do not add:**
- WebLLM (PR #9)
- Browser-local adapters (PR #9)
- Capability negotiation (defer if needed)
- Model configuration (defer if needed)
- Registry/discovery (defer if needed)
- MCP or plugin system (defer if needed)
- Autonomous loops (defer if needed)

**Treat as contract violations** (don't work around):
- If kernel interface doesn't support the scenario → audit, don't patch
- If evidence format is insufficient → audit, don't extend silently
- If Playwright dependency is a problem → document, don't abstract

---

## Critical Audit Before Closing PR #8

Verify **dependency direction** (not just "does it work?"):

```
✅ CLI layer
   knows: adapters, kernel interface
   knows NOT: kernel implementation, semantics

✅ CliPlannerAdapter
   produces: BrowserAction
   knows NOT: execution, kernel state machine

✅ aipw-core Kernel (PR #5)
   owns: task semantics, validation, progression
   knows NOT: CLI, Obscura, CDP, browser lifecycle, Playwright

✅ PlaywrightBrowserExecutor (PR #5)
   executes: validated actions
   knows NOT: task semantics, kernel state machine

✅ Obscura
   is: the real browser runtime
```

**The proof:** If dependencies flow CLI → adapters → kernel, and kernel knows nothing about CLI/browser/runtime, then the architecture is correct.

---

## Architecture Test: PR #9

PR #9 is the **substitution test**:

Replace `CliPlannerAdapter` with `WebLLMPlannerAdapter`.
Change nothing else.

```
PR #8                            PR #9
CLI          same                CLI          (same)
  ↓                                ↓
Planner      Deterministic   →   Planner      WebLLM
  ↓                                ↓
Kernel       PR #5 (same)         Kernel       PR #5 (same)
  ↓                                ↓
Executor     Playwright/Obscura   Executor     Playwright/Obscura (same)
  ↓                                ↓
Result       PASS/FAIL + JSON     Result       PASS/FAIL + JSON (same)
```

If PR #9 only changes the planner and everything else works unchanged, that is the definitive proof PR #7's architecture is correct.

---

## Contract

**Do not reopen architecture questions in PR #8.**

Treat `docs/PR_8_CLI_IMPLEMENTATION.md` as the contract.

If implementation exposes:
- Kernel limitation → document and defer to PR #9+
- Adapter contract issue → audit, don't work around
- Naming/boundary confusion → clarify, don't change architecture

---

## Reference Documents

- `docs/PR_7_EXECUTION_ARCHITECTURE_SPIKE.md` — Canonical scenario + decision gates
- `docs/ExecutionArchitectureDesign.md` — Architecture design + PR #8 path
- `docs/CONTRACT_AUDIT.md` — Verification against actual PR #5 kernel
- `docs/PR_8_CLI_IMPLEMENTATION.md` — Implementation contract (detailed scope/non-scope)

---

## Current Repository State

- PR #4: Runtime proof (Kernel + Playwright + Obscura) → MERGED
- PR #5: Portable kernel (state machine, validation, trace) → MERGED
- PR #6: Browser-local feasibility → READY TO MERGE
- PR #7: Execution architecture (decision spike + contract audit) → READY TO MERGE (FROZEN)
- PR #8: CLI implementation → READY TO START (this PR)
- PR #9: WebLLM planner swap → AFTER PR #8 (swaps only adapter)

---

## Immediate Next Step

Implement PR #8 to this contract. No architecture work. Do not revisit design decisions.

Success: Real developer runs CLI and gets deterministic PASS/FAIL with evidence.
