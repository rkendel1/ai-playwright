# ai-playwright

AI Playwright is a local-first browser automation runtime with a constrained action protocol.

## MVP capabilities

- Obscura runtime adapter (`packages/obscura/runtime.ts`)
- WebLLM planner adapter (`packages/webllm/planner.ts`)
- Playwright executor adapter (`packages/core/executor.ts`)
- Observe → plan → validate → execute loop (`packages/core/task.ts`)
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
  model: "webllm",
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
npx tsx packages/cli/index.ts run --url http://localhost:3000 "Create a project called Demo and verify it appears"
```
