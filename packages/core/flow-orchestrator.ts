import type { Page } from "playwright";
import type { Observation } from "./observer.js";
import type { BrowserAction } from "./action-schema.js";

export type StepType =
  | "natural"      // Natural language instruction for LLM planning
  | "click"        // Click an element (with locator)
  | "fill"         // Fill text field (with text)
  | "wait"         // Wait for condition (URL, element, time, or state)
  | "pause"        // Pause and wait for user to resume
  | "breakpoint"   // Breakpoint with optional condition
  | "screenshot"   // Take screenshot
  | "observe"      // Capture page state
  | "assert"       // Verify condition
  | "select"       // Select dropdown/radio option
  | "submit"       // Submit form
  | "navigate";    // Navigate to URL

export type StepStatus = "pending" | "running" | "success" | "failure" | "blocked" | "paused";

export interface TestStep {
  id: string;
  index: number;
  type: StepType;
  description: string;        // Natural language description
  instruction?: string;       // Explicit instruction if not natural language
  locator?: string;          // Element locator for click/fill
  value?: string;            // Value for fill/select
  waitCondition?: string;    // For wait steps: "url:...", "selector:...", "text:...", "time:..."
  timeout?: number;          // Timeout in ms
  status: StepStatus;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface FlowOrchestratorConfig {
  contextWindowSize: number;
  observationBudget: number;  // Reserved tokens for observation
  actionBudget: number;       // Reserved tokens for action planning
  pauseOnFailure?: boolean;
  autoRetry?: boolean;
}

export interface ExecutionContext {
  page: Page;
  observation?: Observation;
  steps: TestStep[];
  currentStepIndex: number;
  paused: boolean;
  pausedReason?: string;
  breakpoints: Set<number>;  // Step indices where breakpoints are set
  evidence: {
    screenshots: Array<{ stepId: string; data: Buffer }>;
    assertions: Array<{ stepId: string; passed: boolean; message: string }>;
  };
}

export class FlowParser {
  /**
   * Parse multi-line test description into structured steps
   * Recognizes:
   * - "Click <locator>" / "click <locator>"
   * - "Fill <locator> with <value>" / "Enter <value> in <locator>"
   * - "Wait for <condition>" where condition can be:
   *   - URL pattern: "wait for /ideas screen to load"
   *   - Element: "wait for sign in button"
   *   - Time: "wait 2 seconds"
   * - "Pause" / "Pause: <reason>"
   * - "Breakpoint" / "Breakpoint: <condition>"
   * - "Screenshot" / "Take screenshot"
   * - "Navigate to <url>"
   * - "Assert <condition>"
   * - Anything else is treated as natural language instruction
   */
  static parse(description: string): TestStep[] {
    const lines = description
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const steps: TestStep[] = [];
    let index = 0;

    for (const line of lines) {
      const step = this.parseLine(line, index);
      if (step) {
        steps.push(step);
        index++;
      }
    }

    return steps;
  }

  private static parseLine(line: string, index: number): TestStep | null {
    const id = `step-${index}-${Date.now()}`;
    const lowerLine = line.toLowerCase();

    // Click command
    const clickMatch = line.match(/^(?:click|Click)\s+(.+)$/i);
    if (clickMatch) {
      return {
        id,
        index,
        type: "click",
        description: line,
        instruction: clickMatch[1],
        locator: clickMatch[1],
        status: "pending",
      };
    }

    // Fill/Enter command - more flexible pattern
    // Matches: "Fill search box with "text"" or "Enter "text" in search field"
    const fillWithMatch = line.match(
      /^(?:fill|enter)\s+(.+?)\s+with\s+(?:"([^"]+)"|'([^']+)'|(.+))$/i
    );
    if (fillWithMatch) {
      const locator = fillWithMatch[1];
      const value = fillWithMatch[2] || fillWithMatch[3] || fillWithMatch[4];
      return {
        id,
        index,
        type: "fill",
        description: line,
        instruction: `${value} in ${locator}`,
        locator,
        value,
        status: "pending",
      };
    }

    // Alternative fill pattern: "Enter "value" in field"
    const fillInMatch = line.match(
      /^(?:enter)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+in(?:to)?\s+(.+)$/i
    );
    if (fillInMatch) {
      const value = fillInMatch[1] || fillInMatch[2] || fillInMatch[3];
      const locator = fillInMatch[4];
      return {
        id,
        index,
        type: "fill",
        description: line,
        instruction: `${value} in ${locator}`,
        locator,
        value,
        status: "pending",
      };
    }

    // Wait command
    const waitMatch = line.match(/^(?:wait|Wait)\s+(?:for\s+)?(.+)$/i);
    if (waitMatch) {
      const condition = waitMatch[1];
      return {
        id,
        index,
        type: "wait",
        description: line,
        instruction: condition,
        waitCondition: condition,
        timeout: this.extractTimeout(condition),
        status: "pending",
      };
    }

    // Pause command
    if (lowerLine === "pause" || lowerLine.startsWith("pause:")) {
      const reason =
        lowerLine === "pause"
          ? undefined
          : line.substring(line.indexOf(":") + 1).trim();
      return {
        id,
        index,
        type: "pause",
        description: line,
        instruction: reason,
        status: "pending",
      };
    }

    // Breakpoint command
    if (lowerLine === "breakpoint" || lowerLine.startsWith("breakpoint:")) {
      const condition =
        lowerLine === "breakpoint" ? undefined : lowerLine.substring(11).trim();
      return {
        id,
        index,
        type: "breakpoint",
        description: line,
        instruction: condition,
        status: "pending",
      };
    }

    // Screenshot command
    if (lowerLine === "screenshot" || lowerLine === "take screenshot") {
      return {
        id,
        index,
        type: "screenshot",
        description: line,
        status: "pending",
      };
    }

    // Navigate command
    const navMatch = line.match(/^(?:navigate|go)\s+(?:to\s+)?(.+)$/i);
    if (navMatch) {
      const url = navMatch[1];
      return {
        id,
        index,
        type: "navigate",
        description: line,
        instruction: url,
        value: url,
        status: "pending",
      };
    }

    // Assert command
    const assertMatch = line.match(/^(?:assert|verify|check)\s+(.+)$/i);
    if (assertMatch) {
      return {
        id,
        index,
        type: "assert",
        description: line,
        instruction: assertMatch[1],
        status: "pending",
      };
    }

    // Select command - can be "Select value" or "Select value in dropdown"
    const selectWithFromMatch = line.match(/^(?:select)\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s+(?:in|from)\s+(.+)$/i);
    if (selectWithFromMatch) {
      const value = selectWithFromMatch[1] || selectWithFromMatch[2] || selectWithFromMatch[3];
      const locator = selectWithFromMatch[4];
      return {
        id,
        index,
        type: "select",
        description: line,
        instruction: `${value} from ${locator}`,
        locator,
        value,
        status: "pending",
      };
    }

    // Select without "in/from" - just the value
    const selectMatch = line.match(/^(?:select)\s+(?:"([^"]+)"|'([^']+)'|(.+))$/i);
    if (selectMatch) {
      const value = selectMatch[1] || selectMatch[2] || selectMatch[3];
      return {
        id,
        index,
        type: "select",
        description: line,
        instruction: value,
        value,
        status: "pending",
      };
    }

    // Default: treat as natural language instruction
    return {
      id,
      index,
      type: "natural",
      description: line,
      instruction: line,
      status: "pending",
    };
  }

  private static extractTimeout(condition: string): number {
    const timeMatch = condition.match(/(\d+)\s*(?:second|sec|ms|millisecond)/i);
    if (timeMatch) {
      const value = parseInt(timeMatch[1], 10);
      if (condition.toLowerCase().includes("ms")) {
        return value;
      }
      return value * 1000; // Convert seconds to ms
    }
    return 5000; // Default 5s timeout
  }
}

export class StepScheduler {
  private context: ExecutionContext;
  private planner: (observation: Observation, instruction: string) => Promise<BrowserAction>;
  private executor: (action: BrowserAction) => Promise<void>;
  private observer: (page: Page) => Promise<Observation>;

  constructor(
    context: ExecutionContext,
    planner: (observation: Observation, instruction: string) => Promise<BrowserAction>,
    executor: (action: BrowserAction) => Promise<void>,
    observer: (page: Page) => Promise<Observation>
  ) {
    this.context = context;
    this.planner = planner;
    this.executor = executor;
    this.observer = observer;
  }

  async executeStep(step: TestStep): Promise<void> {
    step.status = "running";
    step.startedAt = Date.now();

    try {
      switch (step.type) {
        case "natural":
          await this.executeNatural(step);
          break;
        case "click":
          await this.executeClick(step);
          break;
        case "fill":
          await this.executeFill(step);
          break;
        case "wait":
          await this.executeWait(step);
          break;
        case "navigate":
          await this.executeNavigate(step);
          break;
        case "screenshot":
          await this.executeScreenshot(step);
          break;
        case "pause":
          await this.executePause(step);
          break;
        case "breakpoint":
          await this.executeBreakpoint(step);
          break;
        case "observe":
          await this.executeObserve(step);
          break;
        case "assert":
          await this.executeAssert(step);
          break;
        case "submit":
          await this.executeSubmit(step);
          break;
        case "select":
          await this.executeSelect(step);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      step.status = "success";
    } catch (error) {
      step.status = "failure";
      step.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      step.completedAt = Date.now();
    }
  }

  private async executeNatural(step: TestStep): Promise<void> {
    // Capture observation for LLM planning
    this.context.observation = await this.observer(this.context.page);

    // Plan action using LLM
    const action = await this.planner(this.context.observation, step.instruction || step.description);

    // Execute planned action
    await this.executor(action);
    step.result = { type: "action_executed", action };
  }

  private async executeClick(step: TestStep): Promise<void> {
    if (!step.locator) {
      throw new Error("Click step requires a locator");
    }

    // First observe to get current state
    this.context.observation = await this.observer(this.context.page);

    // Create a click action and execute it
    const action: BrowserAction = {
      type: "click",
      locator: { type: "text", text: step.locator },
    };

    await this.executor(action);
    step.result = { type: "clicked", locator: step.locator };
  }

  private async executeFill(step: TestStep): Promise<void> {
    if (!step.locator || !step.value) {
      throw new Error("Fill step requires both locator and value");
    }

    this.context.observation = await this.observer(this.context.page);

    const action: BrowserAction = {
      type: "fill",
      locator: { type: "label", label: step.locator },
      fallbackLocators: [
        { type: "placeholder", placeholder: step.locator },
        { type: "name", name: step.locator },
        { type: "text", text: step.locator },
      ],
      value: step.value,
    };

    await this.executor(action);
    step.result = { type: "filled", locator: step.locator, value: step.value };
  }

  private async executeWait(step: TestStep): Promise<void> {
    if (!step.waitCondition) {
      throw new Error("Wait step requires a condition");
    }

    const timeout = step.timeout || 5000;
    const condition = step.waitCondition.toLowerCase();

    if (condition.includes("second") || condition.match(/^\d+/)) {
      // Time-based wait
      const ms = this.parseTimeValue(step.waitCondition);
      await this.sleep(ms);
      step.result = { type: "waited", ms };
      return;
    }

    if (condition.includes("/") || condition.includes("screen") || condition.includes("page")) {
      // URL/path wait
      await this.waitForUrl(step.waitCondition, timeout);
      step.result = { type: "waited_for_url", condition: step.waitCondition };
      return;
    }

    // Element/text wait
    await this.waitForElement(step.waitCondition, timeout);
    step.result = { type: "waited_for_element", condition: step.waitCondition };
  }

  private async executeNavigate(step: TestStep): Promise<void> {
    if (!step.value) {
      throw new Error("Navigate step requires a URL");
    }

    await this.context.page.goto(step.value);
    step.result = { type: "navigated", url: step.value };
  }

  private async executeScreenshot(step: TestStep): Promise<void> {
    const buffer = await this.context.page.screenshot();
    this.context.evidence.screenshots.push({
      stepId: step.id,
      data: buffer,
    });
    step.result = { type: "screenshot_taken", size: buffer.length };
  }

  private async executePause(step: TestStep): Promise<void> {
    this.context.paused = true;
    this.context.pausedReason = step.instruction;
    step.status = "paused";
    step.result = { type: "paused", reason: step.instruction };

    // Wait for external resume signal (would be called by UI)
    await this.waitForResume();
  }

  private async executeBreakpoint(step: TestStep): Promise<void> {
    // Breakpoints pause execution if condition is met or unconditionally
    if (!step.instruction) {
      // Unconditional breakpoint
      this.context.paused = true;
      this.context.pausedReason = "Breakpoint reached";
      step.status = "paused";
      await this.waitForResume();
    } else {
      // Conditional breakpoint - check condition
      const shouldPause = await this.evaluateCondition(step.instruction);
      if (shouldPause) {
        this.context.paused = true;
        this.context.pausedReason = `Breakpoint: ${step.instruction}`;
        step.status = "paused";
        await this.waitForResume();
      }
    }

    step.result = { type: "breakpoint", paused: this.context.paused };
  }

  private async executeObserve(step: TestStep): Promise<void> {
    this.context.observation = await this.observer(this.context.page);
    step.result = { type: "observed", elementCount: this.context.observation.elements.length };
  }

  private async executeAssert(step: TestStep): Promise<void> {
    if (!step.instruction) {
      throw new Error("Assert step requires a condition");
    }

    this.context.observation = await this.observer(this.context.page);

    // Evaluate assertion using observation
    const passed = this.evaluateAssertion(step.instruction, this.context.observation);

    this.context.evidence.assertions.push({
      stepId: step.id,
      passed,
      message: step.instruction,
    });

    if (!passed) {
      throw new Error(`Assertion failed: ${step.instruction}`);
    }

    step.result = { type: "assertion", passed, message: step.instruction };
  }

  private async executeSubmit(step: TestStep): Promise<void> {
    if (!step.locator) {
      throw new Error("Submit step requires a form locator");
    }

    this.context.observation = await this.observer(this.context.page);

    const action: BrowserAction = {
      type: "click",
      locator: { type: "text", text: step.locator },
    };

    await this.executor(action);
    step.result = { type: "form_submitted", locator: step.locator };
  }

  private async executeSelect(step: TestStep): Promise<void> {
    if (!step.locator || !step.value) {
      throw new Error("Select step requires both locator and value");
    }

    this.context.observation = await this.observer(this.context.page);

    const action: BrowserAction = {
      type: "select",
      locator: { type: "label", label: step.locator },
      fallbackLocators: [
        { type: "name", name: step.locator },
        { type: "text", text: step.locator },
      ],
      value: step.value,
    };

    await this.executor(action);
    step.result = { type: "option_selected", locator: step.locator, value: step.value };
  }

  private parseTimeValue(condition: string): number {
    const match = condition.match(/(\d+)\s*(?:second|sec|ms|millisecond)?/i);
    if (match) {
      const value = parseInt(match[1], 10);
      if (condition.toLowerCase().includes("ms")) {
        return value;
      }
      return value * 1000;
    }
    return 1000;
  }

  private async waitForUrl(pattern: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    const urlPattern = pattern.split("/").pop() || pattern;

    while (Date.now() - startTime < timeout) {
      const url = this.context.page.url();
      if (url.includes(urlPattern)) {
        return;
      }
      await this.sleep(100);
    }

    throw new Error(`Timeout waiting for URL pattern: ${pattern}`);
  }

  private async waitForElement(selector: string, timeout: number): Promise<void> {
    await this.context.page.waitForSelector(selector, { timeout }).catch(() => {
      throw new Error(`Timeout waiting for element: ${selector}`);
    });
  }

  private async waitForResume(): Promise<void> {
    // This would be called by the UI when user clicks Resume
    // For now, we'll use a polling mechanism with a default timeout
    const maxWaitTime = 30 * 60 * 1000; // 30 minutes max pause
    const startTime = Date.now();

    while (this.context.paused && Date.now() - startTime < maxWaitTime) {
      await this.sleep(100);
    }

    if (this.context.paused) {
      throw new Error("Pause timeout exceeded");
    }
  }

  private async evaluateCondition(condition: string): Promise<boolean> {
    // Simple condition evaluation - can be extended
    if (!this.context.observation) {
      return false;
    }

    const text = (this.context.observation.text ?? "").toLowerCase();
    return text.includes(condition.toLowerCase());
  }

  private evaluateAssertion(assertion: string, observation: Observation): boolean {
    const text = (observation.text ?? "").toLowerCase();
    const assertion_lower = assertion.toLowerCase();

    // Check for "visible" assertions
    if (assertion_lower.includes("visible")) {
      const element = assertion_lower.match(/(.+)\s+visible/)?.[1];
      if (element) {
        return observation.elements.some(
          (e) => e.name?.toLowerCase().includes(element) && e.state.visible
        );
      }
    }

    // Check for text presence
    if (assertion_lower.includes("present") || assertion_lower.includes("shows")) {
      const searchText = assertion.split(/(?:present|shows)/i)[1]?.trim();
      if (searchText) {
        return text.includes(searchText.toLowerCase());
      }
    }

    // Default: check if assertion text is in page
    return text.includes(assertion_lower);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class FlowOrchestrator {
  private context: ExecutionContext;
  private scheduler: StepScheduler;
  private config: FlowOrchestratorConfig;

  constructor(
    page: Page,
    config: FlowOrchestratorConfig,
    planner: (observation: Observation, instruction: string) => Promise<BrowserAction>,
    executor: (action: BrowserAction) => Promise<void>,
    observer: (page: Page) => Promise<Observation>
  ) {
    this.config = config;
    this.context = {
      page,
      steps: [],
      currentStepIndex: 0,
      paused: false,
      breakpoints: new Set(),
      evidence: {
        screenshots: [],
        assertions: [],
      },
    };

    this.scheduler = new StepScheduler(this.context, planner, executor, observer);
  }

  parseAndPrepare(testDescription: string): TestStep[] {
    this.context.steps = FlowParser.parse(testDescription);
    return this.context.steps;
  }

  setBreakpoint(stepIndex: number): void {
    this.context.breakpoints.add(stepIndex);
  }

  clearBreakpoint(stepIndex: number): void {
    this.context.breakpoints.delete(stepIndex);
  }

  async resume(): Promise<void> {
    this.context.paused = false;
    this.context.pausedReason = undefined;
  }

  async executeStep(stepIndex: number): Promise<void> {
    if (stepIndex >= this.context.steps.length) {
      throw new Error(`Invalid step index: ${stepIndex}`);
    }

    const step = this.context.steps[stepIndex];
    this.context.currentStepIndex = stepIndex;

    await this.scheduler.executeStep(step);

    // Check if we hit a breakpoint
    if (this.context.breakpoints.has(stepIndex + 1)) {
      this.context.paused = true;
      this.context.pausedReason = `Breakpoint at step ${stepIndex + 1}`;
    }
  }

  async executeAll(): Promise<void> {
    for (let i = 0; i < this.context.steps.length; i++) {
      if (this.context.paused) {
        break;
      }

      await this.executeStep(i);
    }
  }

  getCurrentStep(): TestStep | undefined {
    return this.context.steps[this.context.currentStepIndex];
  }

  getSteps(): TestStep[] {
    return this.context.steps;
  }

  getContext(): ExecutionContext {
    return this.context;
  }

  getEvidence() {
    return this.context.evidence;
  }
}
