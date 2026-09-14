/**
 * Flow Orchestration Integration Example
 *
 * Shows how to integrate the flow orchestrator with:
 * - Action executor
 * - Planner (WebLLM or API-based)
 * - Observer
 * - Rate limiter
 * - Screenshot evidence
 * - Result caching
 */

import { Page } from "playwright";
import { FlowOrchestrator, FlowParser } from "../packages/core/flow-orchestrator.js";
import { ActionExecutor } from "../packages/core/action-executor.js";
import { ContextAwareObserver, optimizationStrategies } from "../packages/core/observation-optimizer.js";
import { PageRateLimitInterceptor, rateLimiterPresets } from "../packages/core/rate-limiter.js";
import { actionCache, createCacheKey } from "../packages/core/action-cache.js";
import { ScreenshotManager, ScreenshotCollector } from "../packages/core/screenshot-manager.js";
import type { Observation } from "../packages/core/observer.js";
import type { BrowserAction } from "../packages/core/action-schema.js";

export async function runFlowWithOrchestration(
  page: Page,
  testDescription: string,
  taskId: string,
  options: {
    planner: (observation: Observation, instruction: string) => Promise<BrowserAction>;
    observer: (page: Page) => Promise<Observation>;
    onStepUpdate?: (step: any) => void;
    pauseOnFailure?: boolean;
    captureScreenshots?: boolean;
  }
) {
  console.log("🚀 Starting flow orchestration execution");

  // 1. Setup components
  const contextObserver = new ContextAwareObserver(4096); // Model context window
  const limiter = new PageRateLimitInterceptor(page, rateLimiterPresets.gentle);
  await limiter.initialize();

  const executor = new ActionExecutor();
  const screenshotManager = new ScreenshotManager({ captureOnSuccess: true });
  const screenshotCollector = new ScreenshotCollector(screenshotManager);

  let stepIndex = 0;

  // 2. Create planner wrapper that applies observation optimization
  const optimizingPlanner = async (observation: Observation, instruction: string) => {
    // Apply observation optimization to save tokens
    const optimized = contextObserver.optimizeForContextWindow(observation, 512);

    // Detect problematic pages
    const pageState = optimizationStrategies.detectPageState(optimized);
    if (pageState !== "normal") {
      throw new Error(`Page state: ${pageState}`);
    }

    console.log(
      `📊 Observation: ${optimized.originalTokenEstimate} → ${optimized.optimizedTokenEstimate} tokens (${optimized.reductionPercent}% reduction)`
    );

    // Call actual planner with optimized observation
    return await options.planner(optimized, instruction);
  };

  // 3. Create executor wrapper that applies rate limiting
  const rateLimitedExecutor = async (action: BrowserAction) => {
    await limiter.waitIfNeeded();
    return await executor.execute(action, page);
  };

  // 4. Create screenshot-aware observer
  const evidenceObserver = async (p: Page): Promise<Observation> => {
    const obs = await options.observer(p);

    // Capture screenshot for current step
    if (options.captureScreenshots) {
      const screenshot = await screenshotCollector.collectForStep(
        p,
        taskId,
        stepIndex,
        "Observation captured",
        "success"
      );
      if (screenshot) {
        console.log(`📸 Screenshot captured: ${screenshot.size} bytes`);
      }
    }

    return obs;
  };

  // 5. Create orchestrator
  const orchestrator = new FlowOrchestrator(
    page,
    {
      contextWindowSize: 4096,
      observationBudget: 512,
      actionBudget: 512,
      pauseOnFailure: options.pauseOnFailure ?? false,
    },
    optimizingPlanner,
    rateLimitedExecutor,
    evidenceObserver
  );

  // 6. Parse and prepare steps
  console.log("📝 Parsing test description...");
  const steps = orchestrator.parseAndPrepare(testDescription);
  console.log(`✅ Parsed ${steps.length} steps`);

  // Print parsed steps
  steps.forEach((step, i) => {
    console.log(`  ${i + 1}. [${step.type.toUpperCase()}] ${step.description}`);
  });

  // 7. Execute steps
  const results = {
    totalSteps: steps.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    evidence: {
      screenshots: 0,
      assertions: 0,
    },
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      stepIndex = i;

      console.log(`\n📌 Step ${i + 1}/${steps.length}: ${step.description}`);

      try {
        await orchestrator.executeStep(i);

        if (step.status === "success") {
          results.successful++;
          console.log(`  ✅ Success`);

          // Log timing
          if (step.startedAt && step.completedAt) {
            const duration = step.completedAt - step.startedAt;
            console.log(`  ⏱ ${duration}ms`);
          }

          // Log result details
          if (step.result) {
            console.log(`  📊 Result: ${JSON.stringify(step.result).substring(0, 100)}...`);
          }
        }

        if (options.onStepUpdate) {
          options.onStepUpdate(step);
        }

        // Check if paused
        if (orchestrator.getContext().paused) {
          console.log(`  ⏸ Paused: ${orchestrator.getContext().pausedReason}`);
          console.log("  ⏹ Waiting for external resume signal...");

          // In a real UI, this would wait for user to click Resume button
          // For now, demonstrate with manual resume
          // await orchestrator.resume();
          // console.log("  ▶ Resumed");
          break; // Stop here in example
        }
      } catch (error) {
        step.status = "failure";
        step.error = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push(`Step ${i + 1}: ${step.error}`);

        console.log(`  ❌ Failed: ${step.error}`);

        if (options.pauseOnFailure) {
          console.log(`  ⏸ Pausing due to failure...`);
          orchestrator.getContext().paused = true;
          orchestrator.getContext().pausedReason = `Step ${i + 1} failed: ${step.error}`;
          break;
        }

        // Continue to next step unless pauseOnFailure
      }
    }
  } finally {
    // 8. Collect evidence
    console.log("\n📦 Collecting evidence...");

    const evidence = orchestrator.getEvidence();
    results.evidence.screenshots = evidence.screenshots.length;
    results.evidence.assertions = evidence.assertions.length;

    // Ask user about screenshots (in real UI)
    if (results.evidence.screenshots > 0 && options.captureScreenshots) {
      const decision = await screenshotCollector.askAboutScreenshots(taskId);
      console.log(`  📸 Screenshots: ${decision.kept} kept, ${decision.discarded} discarded`);
    }

    // 9. Cache successful execution
    if (results.failed === 0) {
      console.log("\n💾 Caching successful execution...");
      const cacheKey = createCacheKey(taskId, page.url());

      actionCache.cacheResult(cacheKey, {
        taskId,
        goal: testDescription,
        url: page.url(),
        steps: steps.map((s) => ({
          type: s.type,
          description: s.description,
          instruction: s.instruction,
          locator: s.locator,
          value: s.value,
        })),
        result: "success",
        completedAt: Date.now(),
        durationMs: steps.reduce((sum, s) => sum + ((s.completedAt ?? 0) - (s.startedAt ?? 0)), 0),
        confidence: 0.95,
        evidence: {
          screenshots: results.evidence.screenshots,
          assertions: results.evidence.assertions,
        },
      });

      console.log(`  ✅ Cached with key: ${cacheKey}`);
    }
  }

  // 10. Print summary
  console.log("\n📊 Execution Summary");
  console.log(`  Total steps: ${results.totalSteps}`);
  console.log(`  ✅ Successful: ${results.successful}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  ⏸ Paused: ${results.skipped}`);
  console.log(`  📸 Screenshots: ${results.evidence.screenshots}`);
  console.log(`  ✔ Assertions: ${results.evidence.assertions}`);

  if (results.errors.length > 0) {
    console.log("\n⚠️  Errors:");
    results.errors.forEach((err) => console.log(`  - ${err}`));
  }

  console.log("\n✅ Flow orchestration complete");

  return {
    success: results.failed === 0,
    results,
    steps,
    evidence: orchestrator.getEvidence(),
  };
}

// Example: Running a complex authentication flow
export async function exampleAuthenticationFlow(page: Page, planner: any, observer: any) {
  const authFlow = `
    Navigate to https://example.com/login
    Fill email field with "user@example.com"
    Fill password field with "password123"
    Click "Sign in" button
    Wait for 2 seconds
    Wait for /dashboard to load
    Assert "Welcome" message visible
    Screenshot
  `;

  return await runFlowWithOrchestration(page, authFlow, "auth-test", {
    planner,
    observer,
    captureScreenshots: true,
    pauseOnFailure: true,
    onStepUpdate: (step) => {
      // Real UI would update step UI here
    },
  });
}

// Example: Running a search flow with pause for verification
export async function exampleSearchWithPause(page: Page, planner: any, observer: any) {
  const searchFlow = `
    Navigate to https://google.com
    Fill search box with "great dane puppies"
    Click Google Search button
    Wait for /search?q= to load
    Pause: Review search results manually
    Assert results are visible
    Screenshot
  `;

  return await runFlowWithOrchestration(page, searchFlow, "search-test", {
    planner,
    observer,
    captureScreenshots: true,
  });
}

// Example: Running a complex form with breakpoints
export async function exampleComplexFormFlow(page: Page, planner: any, observer: any) {
  const formFlow = `
    Navigate to https://example.com/form
    Fill first name with "John"
    Fill last name with "Doe"
    Fill email with "john@example.com"
    Breakpoint: if error message appears
    Click "Submit" button
    Wait for 2 seconds
    Assert form submitted successfully
    Screenshot
  `;

  return await runFlowWithOrchestration(page, formFlow, "form-test", {
    planner,
    observer,
    captureScreenshots: true,
    pauseOnFailure: false, // Continue on failure in this example
  });
}

// Example: Using cached result
export async function runWithCache(
  page: Page,
  taskId: string,
  planner: any,
  observer: any
) {
  const cacheKey = createCacheKey(taskId, page.url());

  // Check cache first
  if (actionCache.hasSuccessfulResult(cacheKey)) {
    console.log("✅ Using cached result - no network requests!");
    const cached = actionCache.getResult(cacheKey);
    return {
      success: true,
      cached: true,
      result: cached,
    };
  }

  // Not cached, run flow
  console.log("🌐 Cache miss - running test...");
  const testDescription = `
    Click search box
    Fill with "query"
    Click search button
    Wait for results
  `;

  return await runFlowWithOrchestration(page, testDescription, taskId, {
    planner,
    observer,
    captureScreenshots: true,
  });
}
