/**
 * CLI Adapter Sketches (Pseudocode)
 *
 * This file demonstrates how external runtime (CLI + Playwright)
 * adapts to kernel's PlannerAdapter and BrowserAdapter interfaces.
 *
 * NOT PRODUCTION CODE — design sketch only
 * Real implementations in PR #8
 */

import {
  PlannerAdapter,
  PlannerRequest,
  PlannerResponse,
  BrowserAdapter,
  BrowserRequest,
  BrowserResponse,
  Observation,
  BrowserAction,
  observationId,
  elementId,
} from "@aipw/core";

// ============================================================================
// REMOTE PLANNER ADAPTER
// ============================================================================
/**
 * Adapts external LLM API to kernel's PlannerAdapter interface
 *
 * Maps:
 *   PlannerRequest → LLM prompt
 *   LLM response → BrowserAction
 *   LLM metadata → PlannerResponse metadata
 */
export class RemotePlannerAdapter implements PlannerAdapter {
  private apiKey: string;
  private model: string;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey || process.env.LLM_API_KEY || "";
  }

  async plan(request: PlannerRequest): Promise<PlannerResponse> {
    // Convert kernel request to natural language prompt
    const prompt = this.buildPrompt(request);

    // Call LLM API
    const response = await this.callLLM(prompt);

    // Parse response into kernel action
    const action = this.parseAction(response);

    return {
      action,
      metadata: {
        model: this.model,
        tokens: response.usage,
        reasoning: response.thinking, // If applicable
      },
    };
  }

  private buildPrompt(request: PlannerRequest): string {
    const { task, observation, policy, history, remainingSteps } = request;

    return `
You are an AI browser automation assistant.

Task: ${task.goal}

Current browser state:
- URL: ${observation.url}
- Title: ${observation.title}
- Visible text: ${observation.text?.substring(0, 500)}...

Available elements:
${observation.elements
  .map(
    (el) =>
      `- ${el.tag}#${el.id} "${el.text}" (visible: ${el.visible}, enabled: ${el.enabled})`
  )
  .join("\n")}

Policy:
- Approval required for: ${policy.approval}
- Allowed origins: ${policy.allowedOrigins}

Previous actions:
${history
  .slice(-5)
  .map(
    (step) =>
      `${step.phase}: ${JSON.stringify(step.action || step.reason)}`
  )
  .join("\n")}

Remaining steps: ${remainingSteps}

Choose your next action. Respond with JSON only:
{
  "type": "click" | "fill" | "navigate" | "assert",
  "target": { "elementId": "...", "selector": "..." },  // For click/fill
  "value": "...",  // For fill
  "url": "...",  // For navigate
  "assertion": { "type": "textVisible", "text": "..." }  // For assert
}
`;
  }

  private async callLLM(prompt: string): Promise<any> {
    // Sketch: Call OpenAI API (or any remote LLM)
    // Real implementation would handle retries, rate limits, etc.

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, // Lower temp for deterministic actions
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API failed: ${response.status}`);
    }

    return await response.json();
  }

  private parseAction(llmResponse: any): BrowserAction {
    // Parse LLM JSON response into kernel action
    // Real implementation would validate schema and handle parse errors

    const message = llmResponse.choices[0].message;
    const actionJson = JSON.parse(message.content);

    return actionJson as BrowserAction;
  }
}

// ============================================================================
// PLAYWRIGHT BROWSER ADAPTER
// ============================================================================
/**
 * Adapts Playwright to kernel's BrowserAdapter interface
 *
 * Maps:
 *   BrowserRequest action → Playwright API call
 *   Playwright state → Observation
 *   Playwright result → BrowserResponse
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
  constructor(private page: any /* playwright.Page */) {}

  async observe(): Promise<Observation> {
    // Capture current browser state using Playwright
    const url = this.page.url();
    const title = await this.page.title();

    // Get all text (simple version; real implementation would be smarter)
    const text = await this.page.textContent("body");

    // Find all interactable elements
    const elements = await this.page.evaluate(() => {
      const interactable = document.querySelectorAll(
        "button, input, a, [role=button], select, textarea"
      );

      return Array.from(interactable).map((el: any, idx: number) => {
        // Generate stable selectors
        const id = (el as any).id || `el-${idx}`;
        const selector = generateSelector(el);
        const rect = el.getBoundingClientRect();

        return {
          id,
          selector,
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().substring(0, 100) || "",
          visible: rect.width > 0 && rect.height > 0,
          enabled: !(el as any).disabled,
          role: (el as any).role || null,
          placeholder: (el as any).placeholder || null,
        };
      });
    });

    return {
      id: observationId(`obs-pw-${Date.now()}`),
      timestamp: Date.now(),
      url,
      title,
      text: text || "",
      elements: elements.map((el) => ({
        ...el,
        id: elementId(el.id),
      })),
    };
  }

  async execute(request: BrowserRequest): Promise<BrowserResponse> {
    const { action, observationId: obsId } = request;

    try {
      switch (action.type) {
        case "click": {
          await this.handleClick(action);
          break;
        }

        case "fill": {
          await this.handleFill(action);
          break;
        }

        case "navigate": {
          await this.page.goto(action.url, { waitUntil: "networkidle" });
          break;
        }

        case "assert": {
          await this.handleAssertion(action);
          break;
        }

        default:
          return {
            result: {
              status: "rejected",
              reason: `Unknown action type: ${(action as any).type}`,
            },
          };
      }

      // Success: return updated observation
      return {
        result: { status: "success" },
        observation: await this.observe(),
      };
    } catch (error: any) {
      // Handle different error types
      if (error.message.includes("Assertion failed")) {
        return {
          result: {
            status: "failed",
            reason: error.message,
          },
        };
      }

      // Unexpected error (element not found, timeout, etc.)
      return {
        result: {
          status: "failed",
          reason: `Execution failed: ${error.message}`,
        },
        evidence: {
          error: error.message,
          action: action,
        },
      };
    }
  }

  private async handleClick(action: any): Promise<void> {
    // Resolve element reference
    const selector = this.resolveSelector(action.target);

    // Ensure element is visible before clicking
    await this.page.waitForSelector(selector, { timeout: 5000 });
    await this.page.click(selector);

    // Wait for possible navigation or state change
    await this.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
      // It's ok if no navigation happens
    });
  }

  private async handleFill(action: any): Promise<void> {
    const selector = this.resolveSelector(action.target);

    await this.page.waitForSelector(selector, { timeout: 5000 });
    await this.page.fill(selector, action.value);

    // Small delay for input validation
    await this.page.waitForTimeout(300);
  }

  private async handleAssertion(action: any): Promise<void> {
    const { assertion } = action;

    if (assertion.type === "textVisible") {
      const found = await this.page.evaluate((text: string) => {
        return document.body.textContent?.includes(text) ?? false;
      }, assertion.text);

      if (!found) {
        throw new Error(`Assertion failed: Text "${assertion.text}" not visible`);
      }
    } else if (assertion.type === "urlMatches") {
      const url = this.page.url();
      const matches = new RegExp(assertion.pattern).test(url);
      if (!matches) {
        throw new Error(`Assertion failed: URL "${url}" does not match "${assertion.pattern}"`);
      }
    } else {
      throw new Error(`Unknown assertion type: ${assertion.type}`);
    }
  }

  private resolveSelector(target: any): string {
    // Try various ways to identify element
    if (target.selector) {
      return target.selector;
    }

    if (target.elementId) {
      // Might be a hash-based ID; search by text or data-testid
      return `[data-testid="${target.elementId}"], #${target.elementId}`;
    }

    throw new Error("Cannot resolve element selector");
  }
}

// ============================================================================
// HELPERS (Would be utilities in real code)
// ============================================================================

function generateSelector(el: any): string {
  // Simple selector generation
  // Real implementation would be more sophisticated (CSS path, data-testid, etc.)

  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  if (el.testid) return `[data-testid="${el.testid}"]`;

  // Fallback: CSS path
  const path = [];
  let node = el;
  while (node && node.tagName !== "HTML") {
    let selector = node.tagName.toLowerCase();

    if (node.id) {
      selector += `#${node.id}`;
      path.unshift(selector);
      break;
    }

    let sibling = node.previousElementSibling;
    let nth = 1;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === selector) nth++;
      sibling = sibling.previousElementSibling;
    }

    if (nth > 1) selector += `:nth-of-type(${nth})`;
    path.unshift(selector);
    node = node.parentElement;
  }

  return path.join(" > ");
}

// ============================================================================
// USAGE EXAMPLE (How CLI would use these adapters)
// ============================================================================

/**
 * Example: How CLI entry point uses both adapters with kernel
 *
 * ```typescript
 * import { Kernel } from "@aipw/core";
 * import { RemotePlannerAdapter, PlaywrightBrowserAdapter } from "./adapters-sketch";
 *
 * async function runCliTask(url: string, task: string, model: string) {
 *   // Launch browser
 *   const browser = await chromium.launch();
 *   const page = await browser.newPage();
 *   await page.goto(url);
 *
 *   // Create adapters
 *   const planner = new RemotePlannerAdapter(model);
 *   const executor = new PlaywrightBrowserAdapter(page);
 *
 *   // Run kernel
 *   const kernel = new Kernel(
 *     { id: taskId("cli-task"), goal: task },
 *     {}, // policy: defaults to allow
 *     { maxSteps: 50, maxTimeMs: 300_000 },
 *     planner,
 *     executor
 *   );
 *
 *   const result = await kernel.run();
 *
 *   // Report result
 *   console.log(JSON.stringify(result, null, 2));
 *
 *   // Cleanup
 *   await browser.close();
 * }
 * ```
 */
