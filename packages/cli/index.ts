#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { aiPlaywright } from "../core/index.js";
import { CliPlannerAdapter } from "./adapters/CliPlannerAdapter.js";

/**
 * AI Playwright CLI — PR #8 Vertical Slice
 *
 * Proves the complete path:
 * CLI → CliPlannerAdapter → PR #5 Kernel → Playwright → Obscura → real app → TaskResult
 *
 * Usage:
 *   npx ai-playwright --url http://127.0.0.1:3000 "test checkout"
 */

export function parseArgs(args: string[]) {
  let url: string | undefined;
  let headed = false;
  let artifactsDir = path.join(process.cwd(), ".ai-playwright-results");
  const instructionParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--url") {
      url = args[++i];
    } else if (token === "--headed") {
      headed = true;
    } else if (token === "--artifacts") {
      artifactsDir = args[++i];
    } else if (!token.startsWith("-")) {
      instructionParts.push(token);
    }
  }

  const instruction = instructionParts.join(" ").trim();

  return { url, instruction, headed, artifactsDir };
}

async function main() {
  const startedAt = Date.now();
  const { url, instruction, headed, artifactsDir } = parseArgs(process.argv.slice(2));

  // Validate inputs
  if (!url) {
    console.error("Error: --url <URL> is required");
    console.error("Usage: npx ai-playwright --url http://127.0.0.1:3000 \"test checkout\"");
    process.exit(1);
  }

  if (!instruction) {
    console.error("Error: task description is required");
    console.error("Usage: npx ai-playwright --url http://127.0.0.1:3000 \"test checkout\"");
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

  console.log("\nAI Playwright");
  console.log(`Target:  ${url}`);
  console.log(`Task:    ${instruction}`);
  console.log(`Browser: Obscura\n`);

  try {
    // Launch browser with CliPlannerAdapter (deterministic for PR #8)
    const browser = await aiPlaywright({
      browser: "obscura",
      headless: !headed,
      planner: new CliPlannerAdapter(),
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
