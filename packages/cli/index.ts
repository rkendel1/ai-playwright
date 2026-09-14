#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { aiPlaywright, type PlannerMode } from "../core/index.js";
import { initWorkspace, runTestCommand, listTestsCommand, startUICommand } from "./workspace-commands.js";
import { CliPlannerAdapter } from "./adapters/CliPlannerAdapter.js";

/**
 * Runora CLI — PR #9 Workspace
 *
 * Two modes:
 * 1. Workspace mode (default):
 *    npx runora init
 *    npx runora test [name]
 *
 * 2. One-shot mode (PR #8 compatibility):
 *    npx runora --url http://127.0.0.1:3000 "test checkout"
 *
 * Both modes use the same runner:
 * CLI → runner → CliPlannerAdapter → kernel → Playwright/Obscura
 */

function parsePlanner(value: string | undefined): PlannerMode {
  if (["webllm", "ollama", "openai", "anthropic", "deterministic", "mock"].includes(value ?? "")) return value as PlannerMode;
  throw new Error("Planner must be one of: webllm, ollama, openai, anthropic, deterministic");
}

function openInDefaultBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

export function parseArgs(args: string[]) {
  if (args[0] !== "run") {
    throw new Error('Usage: runora run --url <URL> [--planner webllm|deterministic] "task"');
  }

  let url: string | undefined;
  let planner: PlannerMode = "webllm";
  let model: string | undefined;
  let headed = false;
  let artifactsDir = path.join(process.cwd(), ".runora-results");
  const instructionParts: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === "--url") {
      url = args[++i];
    } else if (token === "--planner") {
      planner = parsePlanner(args[++i]);
    } else if (token === "--model") {
      model = args[++i];
    } else if (token === "--headed") {
      headed = true;
    } else if (token === "--artifacts") {
      artifactsDir = args[++i];
    } else if (!token.startsWith("-")) {
      instructionParts.push(token);
    }
  }

  const instruction = instructionParts.join(" ").trim();
  if (!instruction) {
    throw new Error("Please provide a task instruction");
  }

  return { url, planner, model, instruction, headed, artifactsDir };
}

function parseWorkspaceTestArgs(args: string[]): { testName?: string; planner?: PlannerMode; model?: string; url?: string; headless?: boolean } {
  let planner: PlannerMode | undefined;
  let model: string | undefined;
  let url: string | undefined;
  let headless: boolean | undefined;
  const names: string[] = [];

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--planner") {
      planner = parsePlanner(args[++i]);
    } else if (token === "--model") {
      model = args[++i];
    } else if (token === "--url") {
      url = args[++i];
    } else if (token === "--headed") {
      headless = false;
    } else if (token === "--headless") {
      headless = true;
    } else if (!token.startsWith("-")) {
      names.push(token);
    }
  }

  return { testName: names.join(" ").trim() || undefined, planner, model, url, headless };
}

async function oneShotMode(options: ReturnType<typeof parseArgs>) {
  const { url, instruction, artifactsDir, headed, planner, model } = options;
  const startedAt = Date.now();

  // Validate inputs
  if (!url) {
    console.error("Error: --url <URL> is required");
    console.error("Usage: npx runora --url http://127.0.0.1:3000 \"test checkout\"");
    process.exit(1);
  }

  if (!instruction) {
    console.error("Error: task description is required");
    console.error("Usage: npx runora --url http://127.0.0.1:3000 \"test checkout\"");
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`Error: invalid URL "${url}"`);
    process.exit(1);
  }

  // Create artifacts directory
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  console.log("\nRunora");
  console.log(`Target:  ${url}`);
  console.log(`Task:    ${instruction}`);
  console.log(`Planner: ${planner}`);
  if (planner === "webllm") {
    console.log(`Model:   ${model ?? process.env.AIPW_WEBLLM_MODEL ?? "(default)"}`);
  }
  console.log(`Browser: Obscura\n`);

  try {
    const browser = await aiPlaywright({
      browser: "obscura",
      headless: !headed,
      planner: planner === "deterministic" || planner === "mock" ? new CliPlannerAdapter() : planner,
      model: planner === "webllm" && model ? { provider: "webllm", model } : undefined,
      url,
      artifactsDir,
      limits: {
        maxSteps: 50,
        maxTimeMs: 300_000,
      },
    });

    // Run the task through the real kernel
    const result = await browser.task(instruction);

    // Report result
    const statusEmoji = result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⊘";
    const duration = (Date.now() - startedAt) / 1000;
    console.log(`${statusEmoji} ${result.status.toUpperCase()} (${duration.toFixed(1)}s)\n`);

    // Save JSON evidence
    const evidencePath = path.join(artifactsDir, `result-${Date.now()}.json`);
    fs.writeFileSync(evidencePath, JSON.stringify(result, null, 2));

    // Print step summary
    console.log(`Steps executed: ${result.steps.length}`);
    result.steps.forEach((step) => {
      const actionType = (step.action as any)?.type || "observe";
      const status = step.result.status === "success" ? "✓" : "✗";
      console.log(`  ${status} [${step.index}] ${actionType}`);
    });

    // Print evidence summary
    if (result.evidence.length > 0) {
      console.log(`\nAssertions: ${result.evidence.length}`);
      result.evidence.forEach((ev) => {
        const icon = ev.result === "passed" ? "✓" : "✗";
        console.log(`  ${icon} ${ev.assertion}`);
      });
    }

    // Print final result
    if (result.status === "passed") {
      console.log("\n✓ Task completed successfully");
    } else if (result.status === "failed") {
      console.log(`\n✗ Task failed: ${result.error?.reason || "Unknown error"}`);
    } else {
      console.log(`\n⊘ Task blocked: ${result.error?.reason || "Unknown reason"}`);
    }

    console.log(`\nEvidence: ${evidencePath}`);
    console.log(`Artifacts: ${result.artifactsPath}`);

    // Cleanup
    await browser.close();

    // Exit with appropriate code
    process.exit(result.status === "passed" ? 0 : 1);
  } catch (error) {
    console.error("\nError:", error instanceof Error ? error.message : String(error));
    if (process.env.DEBUG && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Determine mode
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Runora");
    console.log("");
    console.log("Usage:");
    console.log("  npx runora init                                                  # Set up and start authoring tests");
    console.log(
      "  npx runora test [name] [--planner webllm|deterministic] [--headed] # Run test(s)"
    );
    console.log("  npx runora ui [port]                                             # Start UI server");
    console.log(
      "  npx runora run --url http://localhost:3000 \"task\"               # One-shot mode"
    );
    process.exit(0);
  } else if (args[0] === "init") {
    const skipBrowserInstall = args.includes("--skip-browser-install");
    const noUI = args.includes("--no-ui");
    const noOpen = args.includes("--no-open");
    const portIndex = args.indexOf("--port");
    const savedPortPath = path.join(process.cwd(), ".runora-ui-port");
    const savedPort = fs.existsSync(savedPortPath)
      ? Number.parseInt(fs.readFileSync(savedPortPath, "utf-8").trim(), 10)
      : 3001;
    const port = portIndex >= 0 ? Number.parseInt(args[portIndex + 1] ?? "", 10) : savedPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("--port must be an integer between 1 and 65535");
    }

    await initWorkspace(process.cwd());

    if (!skipBrowserInstall && !fs.existsSync(chromium.executablePath())) {
      console.log("\nInstalling the browser required to execute tests...");
      const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
      const install = spawnSync(
        npxCommand,
        ["--no-install", "playwright", "install", "chromium"],
        { cwd: process.cwd(), stdio: "inherit" },
      );
      if (install.status !== 0) {
        throw new Error("Unable to install Chromium. Check your network connection and rerun `npx runora init`.");
      }
      console.log("✓ Chromium installed");
    } else if (!skipBrowserInstall) {
      console.log("✓ Chromium is ready");
    }

    if (noUI) process.exit(0);

    let selectedPort = port;
    let server;
    for (;;) {
      try {
        server = await startUICommand(process.cwd(), selectedPort, false);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE" || portIndex >= 0 || selectedPort >= 3099) throw error;
        selectedPort += 1;
      }
    }
    fs.writeFileSync(savedPortPath, String(selectedPort), "utf-8");
    const workspaceURL = `http://localhost:${selectedPort}`;
    console.log(`\n✓ Runora workspace: ${workspaceURL}`);
    console.log("  Application under test: configured separately in runora.config.ts");
    if (selectedPort !== port) console.log(`  Port ${port} was busy, so Runora selected ${selectedPort}.`);
    console.log("  Click “New Test” to start identifying tests.");
    console.log("  Keep this terminal running while you use Runora.\n");
    if (!noOpen) openInDefaultBrowser(workspaceURL);
  } else if (args[0] === "test") {
    // Workspace test mode
    const { testName, planner, model, url, headless } = parseWorkspaceTestArgs(args);
    await runTestCommand(testName, {
      workspaceDir: process.cwd(),
      planner,
      model: planner === "webllm" && model ? { provider: "webllm", model } : undefined,
      url,
      headless,
    });
  } else if (args[0] === "ui") {
    // UI server mode
    const port = args[1] ? parseInt(args[1], 10) : 3001;
    await startUICommand(process.cwd(), port);
    // UI server runs indefinitely
  } else if (args[0] === "run") {
    await oneShotMode(parseArgs(args));
  } else if (args.includes("--url")) {
    // One-shot mode (backward compatibility with PR #8)
    await oneShotMode(parseArgs(["run", ...args]));
  } else {
    // Default: list tests or show help
    if (args[0] === "ls" || args[0] === "list" || args.length === 0) {
      await listTestsCommand();
      process.exit(0);
    } else {
      console.error("Usage:");
      console.error("  npx runora init                                                  # Set up and start authoring tests");
      console.error(
        "  npx runora test [name] [--planner webllm|deterministic]          # Run test(s)"
      );
      console.error("  npx runora ui [port]                                             # Start UI server");
      console.error(
        "  npx runora run --url http://localhost:3000 \"task\"               # One-shot mode"
      );
      process.exit(1);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
