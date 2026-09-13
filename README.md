# ai-playwright

AI Playwright is a local-first browser automation runtime with a constrained action protocol.

## MVP capabilities

- Obscura runtime adapter (`packages/obscura/runtime.ts`)
- WebLLM planner adapter backed by `@mlc-ai/web-llm` (`packages/webllm/planner.ts`)
- Explicit mock planner for deterministic tests (`packages/core/mockPlanner.ts`)
- Playwright executor adapter (`packages/core/executor.ts`)
- Observe → WebLLM inference → schema validation → semantic/policy validation → execute loop (`packages/core/task.ts`)
- Structured trace + screenshots under `.artifacts/task-xxx/`
- TypeScript API (`packages/core/index.ts`)
- CLI (`packages/cli/index.ts`)
- Demo fixture + integration tests (`tests/integration/mvp.test.ts`)

## Quick start

```bash
npm install
curl -LO https://github.com/h4ckf0r0day/obscura/releases/latest/download/obscura-x86_64-linux.tar.gz
tar xzf obscura-x86_64-linux.tar.gz
# ensure ./obscura is on PATH, or set AIPW runtime option obscuraCommand
npx playwright install --with-deps chromium
npm test
```

### API

```ts
import { aiPlaywright } from "./packages/core/index.js";

const browser = await aiPlaywright({
  browser: "obscura",
  planner: "webllm",
  model: {
    provider: "webllm",
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  },
  url: "http://localhost:3000",
});

const result = await browser.task(`
  Open the demo application.
  Create a project named "Demo".
  Verify that "Demo" appears in the project list.
`);

console.log(result);
```

### CLI

```bash
npx tsx packages/cli/index.ts run --planner webllm --url http://localhost:3000 "Create a project called Demo and verify it appears"
```

Use `--planner deterministic` only for deterministic local tests. The WebLLM planner does not fall back to deterministic behavior; if the local WebLLM model cannot initialize, the run fails clearly.

### Workspace config

```ts
export default {
  url: "http://127.0.0.1:3000",
  planner: "webllm",
  model: {
    provider: "webllm",
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  },
};
```

### Real WebLLM acceptance test

The full local acceptance path is gated because it requires Obscura and a local WebLLM-capable environment:

```bash
AIPW_REAL_WEBLLM=1 AIPW_WEBLLM_MODEL=Llama-3.2-1B-Instruct-q4f16_1-MLC npm test -- tests/e2e/real-runtime.e2e.ts
```
