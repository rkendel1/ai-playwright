# Execution Architecture Decision Spike (PR #7)

## Objective

Determine whether the portable kernel abstraction (PR #5) can serve **both browser-local and external runtime deployment modes** with a unified adapter interface, and identify any architectural gaps or capability negotiation requirements.

**Critical principle:** This is a *decision spike*, not an implementation. We answer architectural questions through evidence and documentation, not by building the full system.

## Decision Gates

This spike must answer these questions before PR #8+ implementation can proceed:

### Gate 1: Abstraction Sufficiency

**Question:** Can the same `Kernel` + `PlannerAdapter` + `BrowserAdapter` interfaces satisfy both deployment modes?

**What we're testing:**
- Browser-local mode: WebLLM (in-browser inference) + DOM execution adapter
- External runtime mode: Remote LLM (API/Playwright) + Playwright execution adapter
- Same kernel, different adapter implementations
- Same trace format, different runtime environments

**Success criteria:**
- Both modes use identical `PlannerRequest` / `PlannerResponse` messages
- Both modes use identical `BrowserRequest` / `BrowserResponse` messages
- Kernel makes zero assumptions about which mode is running
- No mode-specific code paths in kernel (kernel never says `if (isRemote)`)
- Message contracts remain stable across both modes

**Exit conditions:**
- ✓ PASS: Kernel is genuinely mode-agnostic; same adapters can serve both
- ✗ FAIL: Fundamental incompatibility (e.g., kernel needs timing guarantees remote can't provide)
- ⊘ BLOCKED: Abstraction works but requires capability negotiation (Gate 2)

---

### Gate 2: Capability Negotiation

**Question:** If one mode can't support a capability the other can, how does the kernel learn about it?

**What we're testing:**
- Browser-local: Can execute clicks, fills, asserts; cannot spawn external processes
- External runtime: Can execute anything with Playwright; cannot directly manipulate DOM
- How does the kernel know what it can ask each adapter to do?
- Can an adapter reject an action safely without killing the task?
- Should there be a `getCapabilities()` handshake before task execution?

**Example scenarios to design for:**
1. User asks kernel to execute "screenshot entire page"
   - Browser-local: Can't do it (screenshot requires pixels)
   - External runtime: Can do it (Playwright → browser → screenshot)
   - How does kernel learn this at runtime?

2. User asks kernel to execute "click element"
   - Browser-local: Can do it (DOM element exists)
   - External runtime: Can do it (Playwright → browser → click)
   - Easy case; both work

3. User asks kernel to execute "run shell command"
   - Browser-local: Can't do it (web page can't exec)
   - External runtime: Can't do it (Playwright doesn't do shell)
   - Both reject; should be same behavior

**Exit conditions:**
- ✓ PASS: Capability negotiation model works (explicit handshake, implicit rejection, or both)
- ✗ FAIL: No safe way to express unsupported capabilities
- ⊘ BLOCKED: Requires trace redesign to handle capability changes mid-task

---

### Gate 3: Trace Portability and Replay

**Question:** Can a task's trace (TaskResult + conversation history) be:
1. Created by browser-local kernel, then replayed by external runtime kernel?
2. Created by external runtime kernel, then replayed by browser-local kernel?
3. Streamed between modes mid-execution?

**What we're testing:**
- Trace format is deployment-mode agnostic
- Observation messages contain no mode-specific data
- Action validation rules are stable across modes
- Replay produces identical results given same adapters
- State machine produces identical telemetry across modes

**Example scenarios:**
1. Browser-local trace replay by external runtime
   - Can external runtime replay "click element at offset X,Y on page P"?
   - Does it need element selector, or is coordinate enough?
   - What if page layout differs?

2. External runtime trace replay by browser-local
   - Can browser-local replay "execute JavaScript X"?
   - Does it interpret JS differently than Playwright?
   - What if environment has different globals?

3. Cross-mode sharing
   - Can user start task in browser, pause, send trace to server, resume in Playwright?
   - What happens if server can't execute a browser-local action?
   - Should traces include capability annotations?

**Exit conditions:**
- ✓ PASS: Traces are genuinely portable; replay works cross-mode
- ✗ FAIL: Traces are mode-specific; must redesign action schema
- ⊘ BLOCKED: Traces are portable but replay requires adapter-specific interpretation

---

## Spike Scope

### What We Build (Thin Evidence Layer)

1. **`ExecutionArchitectureDesign.md`**
   - Documents adapter contracts for both modes
   - Sketches capability negotiation protocol (if needed)
   - Defines trace portability requirements
   - Calls out any kernel changes needed

2. **Browser-local adapter sketch** (pseudocode, not production)
   - WebLLM-based PlannerAdapter (simplified; uses same request/response as PR #5)
   - DOM-based BrowserAdapter (same as PR #6, but reviewed for cross-mode compatibility)

3. **External runtime adapter sketch** (pseudocode, not production)
   - Remote LLM PlannerAdapter (API-based; same request/response contract)
   - Playwright BrowserAdapter (sketch; shows how same action schema maps to Playwright)
   - Confirms both adapters satisfy `PlannerAdapter` + `BrowserAdapter` interfaces

4. **Trace portability test**
   - Creates a TaskResult in browser-local mode
   - Demonstrates how external runtime would replay the same trace
   - Documents any assumptions or mismatches

5. **Decision matrix** — for each gate, final decision:
   - Gate 1: Abstraction sufficiency → PASS/FAIL/BLOCKED
   - Gate 2: Capability negotiation → PASS/FAIL/BLOCKED + design (if not FAIL)
   - Gate 3: Trace portability → PASS/FAIL/BLOCKED + constraints (if BLOCKED)

### What We Don't Build

- ❌ Real WebLLM integration (continue using mock from PR #6)
- ❌ Real Playwright execution (pseudocode only)
- ❌ Real remote LLM API (sketch only)
- ❌ Capability negotiation implementation (design only)
- ❌ Deployment mode switching (not in scope)
- ❌ UI or CLI changes
- ❌ Tests for unproven modes (browser-local was proved in PR #6; external runtime is hypothetical)

---

## Success Criteria

The spike is complete when:

1. **All three gates answered** with clear PASS/FAIL/BLOCKED classification and evidence
2. **ExecutionArchitectureDesign.md** documents adapter contracts for both modes
3. **Adapter sketches** (pseudocode) show how both modes implement the same interfaces
4. **Trace portability** demonstrated with a TaskResult example
5. **Decision matrix** with specific requirements for PR #8+ implementation
6. **No ambiguity** — each decision gate has concrete evidence, not "probably works"

## Not Blocking Implementation

If all gates pass, PR #8+ can proceed immediately. If gates are blocked, PR #8+ still proceeds but with documented constraints (e.g., "capability negotiation required"). Only a hard FAIL blocks further work, and FAILs require root-cause analysis and potential kernel redesign.

## Files to Create/Modify

- `docs/ExecutionArchitectureDesign.md` — Decision matrix + adapter contracts + trace requirements
- `packages/external-runtime/adapters-sketch.ts` — Pseudocode for Playwright + remote LLM adapters (optional, if clarifying)
- Potentially: Update `WASM_KERNEL.md` if kernel changes needed

## Timeline and Effort

- Time estimate: 4-6 hours (decision work, not implementation)
- Effort: Documentation, pseudocode sketches, trace examples
- Deliverable: Spec doc + pseudocode + decision matrix (PR is doc + sketches + evidence, not working code)

## Next: PR #8+

Once PR #7 is merged with clear gate decisions:

### If All Gates PASS
- **PR #8:** Browser-local implementation (WebLLM + DOM adapters, from PR #6 working code)
- **PR #9:** External runtime implementation (Playwright + optional remote LLM adapters)
- Both can ship independently or together; kernel is ready for both

### If Gates are BLOCKED (but not FAIL)
- **PR #8:** Implement capability negotiation protocol (if Gate 2 blocked)
- **PR #8:** Extend trace format for portability constraints (if Gate 3 blocked)
- **PR #9:** Browser-local implementation
- **PR #10:** External runtime implementation
- Sequence changes based on blocker priority

### If Any Gate FAIL
- **Investigation:** Root-cause analysis
- **Decision:** Kernel redesign, or separate kernel per mode, or pivot to different abstraction
- Requires PR #7 addendum with failure analysis before PR #8 starts

---

## References

- PR #4: Runtime proof (Kernel + mock + Playwright + Obscura working together)
- PR #5: Portable kernel (WASM-compatible boundary, zero host dependencies)
- PR #6: Browser-local feasibility (Kernel + WebLLM + DOM, evidence-based)
- PR #7: Execution architecture (This spike — design layer, not implementation)
- PR #8+: Deployment modes (concrete implementations once architecture decided)
