# Runora

Runora is an evidence-first browser testing platform.

Describe what you want verified in plain English. Runora uses AI to understand the task, while Playwright performs deterministic browser execution. Every action is constrained, validated, and traceable, and every failure produces the evidence needed to understand what actually happened.

## Shortest path

```bash
npm create runora
cd my-runora-project
npx runora
```

## MVP capabilities

- Obscura runtime adapter (`packages/obscura/runtime.ts`)
- WebLLM planner adapter backed by `@mlc-ai/web-llm` (`packages/webllm/planner.ts`)
- Explicit mock planner for deterministic tests (`packages/core/mockPlanner.ts`)
- Playwright executor adapter (`packages/core/executor.ts`)
- Observe → WebLLM inference → schema validation → semantic/policy validation → execute loop (`packages/core/task.ts`)
- Structured trace + screenshots under `.artifacts/task-xxx/`
- Local FeltDB 0.10 storage for run history, artifact content, and encrypted secret profiles
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

## The Runora Experience

Inside an existing application, install Runora and start its test-authoring workspace:

```bash
npm install runora
npx runora init
```

`init` creates the configuration and test directories, installs Chromium when it
is missing, starts the workspace on an available local port, and opens it in your
default browser. Click **New Test** there to describe each required behavior in
plain English. Keep the terminal running while using the workspace. Pass
`--no-open` if you do not want it to open a browser tab.

Runs are headless by default. Enable **Show browser while tests run** in the
workspace to watch the browser live, or use `npx runora test <name> --headed`.
Use `--headless` to force background mode. The workspace defaults to the
intelligent browser-local WebLLM planner. You can also choose **Ollama**,
**OpenAI**, or **Anthropic (Claude)** from the Planner menu; the limited
deterministic planner remains available as an explicit option.

For Ollama, select **Local (Ollama)**. Runora discovers models from the running
Ollama service and presents them in a dropdown; use **Refresh** after installing
a new model. You can optionally change the default endpoint
`http://127.0.0.1:11434`. This HTTP-based discovery works the same way on macOS,
Windows, and Linux and does not depend on platform-specific install paths. For
OpenAI or Claude, select the provider and choose a saved API key (or enter a
temporary one). Runora loads the
models available to that provider account into a dropdown. You may instead start Runora with
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment. Typed and
environment credentials stay in the local Runora process; they are not written
to configuration, test definitions, run history, screenshots, or evidence.

Use **Secrets Vault** to save reusable website login profiles and OpenAI or
Claude API keys. When creating a test, select a login profile; the test file
stores only its vault ID. Runora fills username/email and password fields
locally, redacts their values before any planner request or trace write, and
masks editable fields in screenshots. Vault values are encrypted with AES-256-GCM
before being stored in the workspace-local FeltDB database. The key and database
live under `.runora/`, which `init` adds to `.gitignore`. Set a base64-encoded
32-byte `RUNORA_VAULT_KEY` to manage the encryption key externally.

FeltDB is the durable local index for run history, suite history, secret
profiles, and content-addressed evidence. Playwright still materializes evidence
files under `artifacts/` so screenshots and traces remain easy to open and
download; Runora can recover stored evidence content through FeltDB.

On the first intelligent run, the workspace downloads the model weights directly
in the browser and displays loading progress. The browser caches those weights
for later runs and requests persistent browser storage so normal refreshes and
Runora restarts do not download them again. Runora also remembers its workspace
port because browser caches are scoped to the local origin; using `localhost` on
a different port creates a separate browser cache. Planning stays in the browser;
the local Runora process performs Playwright execution and writes evidence.

For CI or scripted setup without a running UI, use:

```bash
npx runora init --no-ui --skip-browser-install
```

Then the product flow is:

Create test  
↓  
Run test  
↓  
AI helps understand intent  
↓  
Playwright executes against Obscura  
↓  
Runora records the proof  
↓  
PASS / FAIL  
↓  
Inspect evidence  
↓  
Run the full suite  
↓  
Review saved history

See the complete visual walkthrough in [`docs/CX-WALKTHROUGH.md`](./docs/CX-WALKTHROUGH.md).

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

### One-shot CLI

```bash
npx runora run --planner deterministic --url http://localhost:3000 "Create a project called Demo and verify it appears"
```

Intelligent WebLLM runs are launched from the browser workspace created by
`npx runora init`. This keeps model inference and its persistent cache in the
browser. The one-shot terminal command supports deterministic tasks only.

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
