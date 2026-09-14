#!/usr/bin/env node

/**
 * Runora CLI Entry Point (Pseudocode Sketch)
 *
 * Command line interface for browser-based test automation.
 *
 * Usage:
 *   npx runora "test checkout"
 *   npx runora --url http://localhost:3000 "test checkout"
 *   npx runora --url http://localhost:3000 --task "test checkout" --model gpt-4
 *
 * NOT PRODUCTION CODE — design sketch only
 * Real implementation in PR #8
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, Browser, Page } from "playwright"; // Would be: playwright
import { Kernel, taskId, type TaskResult } from "@aipw/core";
import { RemotePlannerAdapter, PlaywrightBrowserAdapter } from "./adapters-sketch";

// ============================================================================
// CLI TYPES AND OPTIONS
// ============================================================================

interface CliOptions {
  url: string; // Target app URL
  task: string; // Natural language task
  model: string; // LLM model to use
  headless: boolean; // Launch headless browser
  timeout: number; // Max execution time (ms)
  outputJson: string; // Path to save result JSON
  debug: boolean; // Verbose logging
}

interface CliResult {
  status: "passed" | "failed" | "blocked";
  message: string;
  taskId: string;
  duration: number;
  evidence: string; // Path to JSON trace
}

// ============================================================================
// MAIN CLI FUNCTION
// ============================================================================

async function main(): Promise<CliResult> {
  try {
    // Parse command line arguments
    const options = parseArgs(process.argv.slice(2));
    validateOptions(options);

    log(`🚀 Runora CLI`, options.debug);
    log(`   Task: ${options.task}`, options.debug);
    log(`   URL: ${options.url}`, options.debug);
    log(`   Model: ${options.model}`, options.debug);

    // Launch browser
    log(`\n🔍 Launching browser...`, options.debug);
    const browser = await chromium.launch({ headless: options.headless });
    log(`✓ Browser launched`, options.debug);

    try {
      // Create page and navigate to target
      const page = await browser.newPage();
      log(`\n📄 Navigating to ${options.url}...`, options.debug);
      await page.goto(options.url, { waitUntil: "networkidle" });
      log(`✓ Page loaded (${await page.title()})`, options.debug);

      // Create adapters
      const planner = new RemotePlannerAdapter(options.model);
      const executor = new PlaywrightBrowserAdapter(page);

      // Run kernel
      log(`\n⚙️  Running task...`, options.debug);
      const result = await runKernel(options, planner, executor);

      // Report results
      const cliResult = formatResult(result, options);
      reportResult(cliResult);

      return cliResult;
    } finally {
      await browser.close();
      log(`✓ Browser closed`, options.debug);
    }
  } catch (error: any) {
    // Handle top-level errors
    const cliResult: CliResult = {
      status: "failed",
      message: `Error: ${error.message}`,
      taskId: "unknown",
      duration: 0,
      evidence: "",
    };

    reportError(cliResult);
    return cliResult;
  }
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    url: "http://localhost:3000", // Default
    model: "gpt-4o-mini", // Default (cost-effective)
    headless: true,
    timeout: 300_000, // 5 minutes
    debug: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--url") {
      options.url = args[++i];
    } else if (arg === "--task") {
      options.task = args[++i];
    } else if (arg === "--model") {
      options.model = args[++i];
    } else if (arg === "--headed") {
      options.headless = false;
    } else if (arg === "--timeout") {
      options.timeout = parseInt(args[++i], 10) * 1000; // Convert seconds to ms
    } else if (arg === "--output") {
      options.outputJson = args[++i];
    } else if (arg === "--debug") {
      options.debug = true;
    } else if (!arg.startsWith("-")) {
      // Positional argument: task
      options.task = arg;
    }

    i++;
  }

  return options as CliOptions;
}

function validateOptions(options: CliOptions): void {
  if (!options.url) {
    throw new Error("URL is required (--url or default http://localhost:3000)");
  }

  if (!options.task) {
    throw new Error("Task is required (positional or --task)");
  }

  if (!options.model) {
    throw new Error("Model is required (--model or default gpt-4o-mini)");
  }
}

// ============================================================================
// KERNEL EXECUTION
// ============================================================================

async function runKernel(
  options: CliOptions,
  planner: any, // RemotePlannerAdapter
  executor: any // PlaywrightBrowserAdapter
): Promise<TaskResult> {
  const kernel = new Kernel(
    { id: taskId("cli-task"), goal: options.task },
    {}, // Default policy: allow all
    { maxSteps: 50, maxTimeMs: options.timeout },
    planner,
    executor
  );

  const result = await kernel.run();
  return result;
}

// ============================================================================
// RESULT FORMATTING AND REPORTING
// ============================================================================

function formatResult(taskResult: TaskResult, options: CliOptions): CliResult {
  const statusEmoji: Record<string, string> = {
    passed: "✅",
    failed: "❌",
    blocked: "⊘",
  };

  const message =
    taskResult.status === "passed"
      ? `${taskResult.goal} completed successfully`
      : taskResult.status === "blocked"
        ? `Task blocked: unable to proceed`
        : `Task failed: unable to complete`;

  // Save JSON evidence
  const evidencePath = options.outputJson || generateEvidencePath();
  saveEvidence(taskResult, evidencePath);

  const duration = taskResult.steps?.reduce((sum, step) => sum + (step.telemetry?.duration || 0), 0) || 0;

  return {
    status: taskResult.status,
    message: `${statusEmoji[taskResult.status]} ${message}`,
    taskId: taskResult.id,
    duration,
    evidence: evidencePath,
  };
}

function reportResult(result: CliResult): void {
  console.log("\n" + "=".repeat(60));
  console.log(result.message);
  console.log(`\nTask ID: ${result.taskId}`);
  console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
  console.log(`Evidence: ${result.evidence}`);
  console.log("=".repeat(60) + "\n");

  // Exit with appropriate code
  process.exit(result.status === "passed" ? 0 : 1);
}

function reportError(result: CliResult): void {
  console.error(`\n❌ ${result.message}\n`);
  process.exit(1);
}

function saveEvidence(taskResult: TaskResult, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(taskResult, null, 2));
}

function generateEvidencePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), `.runora-results`, `${timestamp}.json`);
}

// ============================================================================
// LOGGING
// ============================================================================

function log(message: string, debug: boolean = false): void {
  if (debug) {
    console.log(message);
  }
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

class AiPlaywrightError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AiPlaywrightError";
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

main()
  .then((result) => {
    process.exit(result.status === "passed" ? 0 : 1);
  })
  .catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });

/**
 * IMPLEMENTATION NOTES FOR PR #8
 *
 * 1. Error Handling
 *    - Wrap Playwright exceptions (timeout, navigation failed, etc.)
 *    - Wrap LLM API errors (rate limit, timeout, auth fail, etc.)
 *    - Provide actionable error messages (not stack traces)
 *    - Example: "Browser timed out waiting for element" instead of "timeout: 5000"
 *
 * 2. Browser Lifecycle
 *    - Support --headed flag for debugging
 *    - Auto-cleanup on signal (SIGTERM, SIGINT)
 *    - Report browser crashes with context
 *    - Support multiple browsers (chromium, firefox, webkit) later
 *
 * 3. LLM Configuration
 *    - Detect API key from environment (OPENAI_API_KEY, etc.)
 *    - Support multiple LLM providers (OpenAI, Anthropic, Groq, local)
 *    - Log token usage for cost tracking
 *    - Cache model downloads (if using local inference)
 *
 * 4. Evidence Output
 *    - Default: print summary to console, save JSON to .runora-results/
 *    - Support: --output to specify custom path
 *    - Support: --no-json to suppress file output
 *    - Consider: --output-format junit|json|html for CI/CD integrations
 *
 * 5. Performance
 *    - Measure wall-clock time vs browser time
 *    - Track LLM inference latency separately
 *    - Report telemetry (token counts, step counts, etc.)
 *    - Log timing breakdowns in debug mode
 *
 * 6. Testing
 *    - Unit tests for argument parsing
 *    - Integration tests with mock LLM + Playwright
 *    - E2E tests with real browser + mock LLM
 *    - Fixture app for testing (same as PR #6's project manager)
 *
 * 7. CI/CD Integration
 *    - Exit code reflects success (0) or failure (1)
 *    - JSON evidence can be parsed by GitHub Actions, GitLab CI, etc.
 *    - Consider: JUnit XML reporter for test systems
 *    - Consider: Artifact upload script for evidence archival
 *
 * 8. Documentation
 *    - README with quick start (10 minutes to first task)
 *    - Configuration guide (API keys, model selection, etc.)
 *    - Troubleshooting guide (common errors, debugging)
 *    - Examples (testing checkout flow, form submission, etc.)
 */
