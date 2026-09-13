# Browser-Local AI Playwright Feasibility Spike (PR #6)

## Objective

Determine whether AI Playwright can run **entirely in a browser without a server** with honest, evidence-based reporting of capabilities and blockers.

**Critical principle:** BROWSER_LOCAL_BLOCKED is a valid and valuable outcome. The goal is evidence, not forcing it to work.

## Architecture

```
Browser
├── aipw-core (portable kernel)
├── WebLLM/WebGPU (local inference)
└── BrowserExecutionAdapter (browser-native execution)

No server.
No WebSocket bridge.
No fallback APIs.
```

## Running the Experiment

### Prerequisites

```bash
npm install
```

### Start the Web App

```bash
npm run web:dev
```

Opens http://localhost:3000 with the feasibility spike UI.

### Two Experiments Available

1. **Mock Experiment (Baseline)**
   - Tests: aipw-core + deterministic mock adapters
   - Purpose: Establishes that the kernel works correctly
   - Expected: Should always PASS

2. **Browser-Local Experiment**
   - Tests: aipw-core + WebLLM (if available) + browser execution
   - Purpose: Probes actual browser-local capabilities
   - Expected: PASS, BLOCKED, or FAIL with clear evidence

## UI Components

### Fixture: Project Manager
- Simple DOM with button, input, list
- Create Project button
- Name input field
- Add to List button
- Projects list (displays created projects)

Task: Create a project named "Demo" and verify it appears in the list.

### Kernel Trace
- Live trace of each step
- Shows validation, execution, results
- Color-coded by status (PASS/FAIL/BLOCKED)

### Capability Report

Tracks five critical capabilities with evidence:

1. **aipw-core loaded**
   - Can the portable kernel run in the browser?
   - PASS: Kernel imports and executes
   - FAIL: Import/execution error

2. **WebLLM/WebGPU**
   - Can we load a model locally in the browser?
   - PASS: Model loads and runs inference
   - BLOCKED: WebLLM/WebGPU not available (environmental)
   - FAIL: Unexpected error

3. **Browser execution**
   - Can we interact with the DOM as an adapter?
   - PASS: Click, fill, assert work on real DOM elements
   - BLOCKED: Certain browser APIs unavailable
   - FAIL: Execution fails unexpectedly

4. **No server fallback**
   - Is all execution happening locally?
   - PASS: No server calls detected
   - FAIL: Server fallback detected

5. **Kernel purity**
   - Is the kernel free of browser/WebGPU/Playwright dependencies?
   - PASS: No forbidden imports found
   - FAIL: Kernel contaminated with host knowledge

## Expected Outcomes

### Scenario 1: BROWSER_LOCAL_PASS

```
aipw-core:       PASS (kernel runs)
WebLLM/WebGPU:   PASS (model loads & infers)
Browser exec:    PASS (DOM manipulation works)
No server:       PASS (local only)
Kernel purity:   PASS (no contamination)

→ BROWSER_LOCAL_PASS

Architecture:
WebLLM → aipw-core → BrowserExecutionAdapter
Full stack runs in-browser with zero server.
```

### Scenario 2: BROWSER_LOCAL_BLOCKED

```
aipw-core:       PASS (kernel runs)
WebLLM/WebGPU:   BLOCKED (no WebGPU in environment)
Browser exec:    PASS (DOM manipulation works)
No server:       PASS (no fallback)
Kernel purity:   PASS (no contamination)

→ BROWSER_LOCAL_BLOCKED

Evidence: WebLLM requires WebGPU support. Browser execution works but inference unavailable.
Next: PR #7 must solve: Can we provide model inference from elsewhere?
```

### Scenario 3: BROWSER_LOCAL_BLOCKED (Execution)

```
aipw-core:       PASS (kernel runs)
WebLLM/WebGPU:   PASS (model loads)
Browser exec:    BLOCKED (Playwright/Obscura unavailable)
No server:       PASS (no fallback)
Kernel purity:   PASS (no contamination)

→ BROWSER_LOCAL_BLOCKED

Evidence: Kernel + inference work. But Playwright/Obscura cannot provide execution
control from within a web page without external process/extension.
Next: PR #7 must solve: What execution model works in-browser?
```

## Key Constraints

### No Server Fallback
If browser execution fails, **do not** add an API endpoint "for now."
The experiment is precisely whether browser-local works.
A blocked result is more valuable than a fake pass.

### No WebSocket Bridge
Do not create:
```typescript
// ❌ Not allowed
socket.emit("execute", action);
```
Everything must happen locally.

### No Browser Extension
Extensions are not "in-browser" for this spike.
We're testing what a normal web page can do.

### No Hidden Mocks
If WebLLM isn't available, the report says BLOCKED.
If browser execution isn't possible, the report says BLOCKED.
Not "mostly works" or "falls back to mock."

## Files

- `index.html` - Fixture and UI
- `src/main.ts` - Kernel runner, experiments, capability tracking
- `FEASIBILITY_SPIKE.md` - This file

## Console Output

Open browser dev tools (F12) to see:
- Kernel trace events
- Error details
- Adapter calls
- Timing information

## Acceptance Criteria

The spike is complete when we can answer these five questions with evidence:

1. Does aipw-core run in a browser?
2. Does real WebLLM/WebGPU inference run in that browser?
3. Can a browser-hosted execution adapter perform actions?
4. Can Playwright/Obscura participate without a server?
5. If not, what exact capability boundary prevents it?

**Final classification must be one of:**
- `BROWSER_LOCAL_PASS`
- `BROWSER_LOCAL_BLOCKED` (with documented blocker)
- `BROWSER_LOCAL_FAIL` (with documented failure)

No ambiguous "mostly works" states.

## Next Steps (After PR #6)

### If BROWSER_LOCAL_PASS
- PR #7: Optimize and polish (not in scope for spike)
- Explore: WebGPU performance, model size, offline capability

### If BROWSER_LOCAL_BLOCKED (Execution)
- PR #7: Design browser-native execution model
- Questions: Can we use CDP+browser-local? Service workers? Headless browser?
- Note: This may be a fundamental architectural limit

### If BROWSER_LOCAL_BLOCKED (Inference)
- PR #7: Design inference delivery (remote, hybrid, cached)
- Questions: Can we cache models? Stream inference? Use remote API?

### If BROWSER_LOCAL_FAIL
- Debug and determine root cause
- Decide if worth pursuing or pivot to different architecture

## Non-Goals

Explicitly **not** in scope for PR #6:

- ❌ UI polish or visual design
- ❌ Production-ready error handling
- ❌ Performance optimization
- ❌ Model variety or new action types
- ❌ Persistent task storage
- ❌ Autonomous agent loops
- ❌ Workflow builder
- ❌ Server fallback "just in case"
- ❌ Real WebLLM integration (mock is fine for architecture)
- ❌ Browser extension
- ❌ WebSocket execution bridge

This is a **feasibility experiment**, not a product.

## Debugging

### If kernel won't load
Check browser console. Ensure TypeScript compilation succeeded.
```bash
npm run build
```

### If WebLLM "loads" but doesn't work
WebGPU may not be available in this browser/OS.
This is a valid BLOCKED result.
Document it in the capability report.

### If DOM interactions fail
Check that element IDs match fixture HTML.
Check that observation detection finds elements correctly.

### If you get "ENVIRONMENT_BLOCKED"
This is **not** a failure of the spike.
It's exactly what we're testing for.
Document which capability is unavailable and why.

## Example Trace Output

```
Step 0: aipw-core — PASS — Loaded successfully
Step 1: WebLLM/WebGPU — BLOCKED — WebLLM not available in browser environment
Step 2: Browser execution — PASS — Testing with mock planner
Step 3: Kernel execution — PASS — Browser execution PASSED

Capability Report:
─────────────────────────
aipw-core loaded:     PASS
WebLLM/WebGPU:        BLOCKED
Browser execution:    PASS
No server fallback:   PASS
Kernel purity:        PASS

Conclusion:
→ BROWSER_LOCAL_BLOCKED

Evidence: Kernel and browser execution work perfectly.
Blocker: WebLLM requires WebGPU which is not available in this environment.
```

## References

- PR #4: Runtime proof (real WebLLM + Playwright + Obscura)
- PR #5: Portable kernel (WASM-compatible boundary)
- PR #6: Browser-local spike (feasibility test)
- PR #7: Next (solve the blocker or pivot architecture)
