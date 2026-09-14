import { describe, it, expect, vi, beforeEach } from "vitest";
import { FlowParser, FlowOrchestrator, StepScheduler, type TestStep } from "../flow-orchestrator.js";
import type { Page } from "playwright";
import type { Observation } from "../observer.js";
import type { BrowserAction } from "../action-schema.js";

describe("FlowParser", () => {
  describe("parsing natural language steps", () => {
    it("should parse click commands", () => {
      const description = "Click Search button";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("click");
      expect(steps[0].locator).toBe("Search button");
    });

    it("should parse fill commands", () => {
      const description = 'Fill search box with "great dane puppies"';
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("fill");
      expect(steps[0].locator).toBe("search box");
      expect(steps[0].value).toBe("great dane puppies");
    });

    it("should parse enter commands (alias for fill)", () => {
      const description = 'Enter "test" in email field';
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("fill");
      expect(steps[0].value).toBe("test");
    });

    it("should parse wait commands with time", () => {
      const description = "Wait 3 seconds";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("wait");
      expect(steps[0].timeout).toBe(3000);
    });

    it("should parse wait commands with URL pattern", () => {
      const description = "Wait for /results page to load";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("wait");
      expect(steps[0].waitCondition).toContain("/results");
    });

    it("should parse navigate commands", () => {
      const description = "Navigate to https://example.com";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("navigate");
      expect(steps[0].value).toBe("https://example.com");
    });

    it("should parse pause commands", () => {
      const description = "Pause: Review results manually";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("pause");
      expect(steps[0].instruction).toBe("Review results manually");
    });

    it("should parse breakpoint commands", () => {
      const description = "Breakpoint: if error appears";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("breakpoint");
    });

    it("should parse screenshot commands", () => {
      const description = "Screenshot";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("screenshot");
    });

    it("should parse assert commands", () => {
      const description = "Assert results are visible";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("assert");
    });

    it("should treat unknown commands as natural language", () => {
      const description = "Fill in the search form and look for results";
      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("natural");
    });
  });

  describe("parsing multi-line descriptions", () => {
    it("should parse multi-step flows", () => {
      const description = `
        Click Search button
        Fill search box with "great dane"
        Wait for results
        Screenshot
        Assert results are visible
      `;

      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(5);
      expect(steps[0].type).toBe("click");
      expect(steps[1].type).toBe("fill");
      expect(steps[2].type).toBe("wait");
      expect(steps[3].type).toBe("screenshot");
      expect(steps[4].type).toBe("assert");
    });

    it("should handle authentication flow", () => {
      const description = `
        Click "Sign in" link
        Fill email with "user@example.com"
        Fill password with "password123"
        Click Sign In button
        Wait for 2 seconds
        Wait for /dashboard to load
        Assert logged in
      `;

      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(7);
      expect(steps[0].type).toBe("click");
      expect(steps[1].type).toBe("fill");
      expect(steps[2].type).toBe("fill");
      expect(steps[3].type).toBe("click");
      expect(steps[4].type).toBe("wait");
      expect(steps[5].type).toBe("wait");
      expect(steps[6].type).toBe("assert");
    });

    it("should skip empty lines", () => {
      const description = `
        Click button

        Fill box with "text"


        Wait for results
      `;

      const steps = FlowParser.parse(description);
      expect(steps).toHaveLength(3);
    });

    it("should preserve step order", () => {
      const description = `
        Step 1: Click
        Step 2: Fill
        Step 3: Wait
      `;

      const steps = FlowParser.parse(description);
      expect(steps[0].index).toBe(0);
      expect(steps[1].index).toBe(1);
      expect(steps[2].index).toBe(2);
    });
  });

  describe("complex scenarios", () => {
    it("should parse login and create flow", () => {
      const description = `
        Click "Sign in here"
        Fill email field with "test@example.com"
        Fill password field with "password"
        Click Sign In button
        Wait for /ideas to load
        Click "Add Idea" button
        Select "Bring your own idea"
        Screenshot
        Pause: Review before submission
      `;

      const steps = FlowParser.parse(description);

      expect(steps).toHaveLength(9);
      expect(steps[0].type).toBe("click");
      expect(steps[1].type).toBe("fill");
      expect(steps[2].type).toBe("fill");
      expect(steps[3].type).toBe("click");
      expect(steps[4].type).toBe("wait");
      expect(steps[5].type).toBe("click");
      expect(steps[6].type).toBe("select");
      expect(steps[7].type).toBe("screenshot");
      expect(steps[8].type).toBe("pause");
    });

    it("should handle case-insensitive commands", () => {
      const description = `
        CLICK Button
        fill textbox with "value"
        WAIT for results
        PaUse
      `;

      const steps = FlowParser.parse(description);
      expect(steps[0].type).toBe("click");
      expect(steps[1].type).toBe("fill");
      expect(steps[2].type).toBe("wait");
      expect(steps[3].type).toBe("pause");
    });
  });

  describe("time parsing", () => {
    it("should parse seconds", () => {
      const steps = FlowParser.parse("Wait 5 seconds");
      expect(steps[0].timeout).toBe(5000);
    });

    it("should parse sec abbreviation", () => {
      const steps = FlowParser.parse("Wait 3 sec");
      expect(steps[0].timeout).toBe(3000);
    });

    it("should parse milliseconds", () => {
      const steps = FlowParser.parse("Wait 500 ms");
      expect(steps[0].timeout).toBe(500);
    });

    it("should default to 5s if no time specified", () => {
      const steps = FlowParser.parse("Wait for results");
      expect(steps[0].timeout).toBe(5000);
    });
  });
});

describe("StepScheduler", () => {
  let mockPage: Page;
  let mockPlanner: any;
  let mockExecutor: any;
  let mockObserver: any;
  let context: any;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn(),
      url: vi.fn().mockReturnValue("https://example.com"),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("image")),
      waitForSelector: vi.fn().mockResolvedValue(true),
    } as any;

    mockObserver = vi.fn().mockResolvedValue({
      id: "obs-1",
      generation: 1,
      text: "Test content",
      title: "Test Page",
      url: "https://example.com",
      elements: [],
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, pageWidth: 1280, pageHeight: 3000 },
    } as Observation);

    mockPlanner = vi.fn().mockResolvedValue({
      type: "click",
      locator: { type: "text", text: "button" },
    } as BrowserAction);

    mockExecutor = vi.fn().mockResolvedValue(undefined);

    context = {
      page: mockPage,
      steps: [],
      currentStepIndex: 0,
      paused: false,
      breakpoints: new Set(),
      evidence: {
        screenshots: [],
        assertions: [],
      },
    };
  });

  it("should execute natural language steps", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step = {
      id: "step-1",
      index: 0,
      type: "natural" as const,
      description: "Search for puppies",
      instruction: "Search for puppies",
      status: "pending" as const,
    };

    await scheduler.executeStep(step);

    expect(mockObserver).toHaveBeenCalled();
    expect(mockPlanner).toHaveBeenCalledWith(expect.any(Object), "Search for puppies");
    expect(mockExecutor).toHaveBeenCalled();
    expect(step.status).toBe("success");
  });

  it("should execute click steps", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step = {
      id: "step-1",
      index: 0,
      type: "click" as const,
      description: "Click Search button",
      locator: "Search button",
      status: "pending" as const,
    };

    await scheduler.executeStep(step);

    expect(mockObserver).toHaveBeenCalled();
    expect(mockExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "click",
        locator: expect.any(Object),
      })
    );
    expect(step.status).toBe("success");
  });

  it("should execute fill steps", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step: TestStep = {
      id: "step-1",
      index: 0,
      type: "fill" as const,
      description: 'Fill search with "puppies"',
      locator: "search box",
      value: "puppies",
      status: "pending" as const,
    };

    await scheduler.executeStep(step);

    expect(mockExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fill",
        value: "puppies",
      })
    );
    expect(step.status).toBe("success");
  });

  it("should handle wait for URL", async () => {
    mockPage.url = vi.fn().mockReturnValue("https://example.com/results");

    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step: TestStep = {
      id: "step-1",
      index: 0,
      type: "wait" as const,
      description: "Wait for /results",
      waitCondition: "/results",
      timeout: 5000,
      status: "pending" as const,
    };

    await scheduler.executeStep(step);
    expect(step.status).toBe("success");
  });

  it("should handle time-based wait", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step = {
      id: "step-1",
      index: 0,
      type: "wait" as const,
      description: "Wait 1 second",
      waitCondition: "1 second",
      timeout: 1000,
      status: "pending" as const,
    };

    const startTime = Date.now();
    await scheduler.executeStep(step);
    const duration = Date.now() - startTime;

    expect(step.status).toBe("success");
    expect(duration).toBeGreaterThanOrEqual(900); // Allow some variance
  });

  it("should execute navigate steps", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step = {
      id: "step-1",
      index: 0,
      type: "navigate" as const,
      description: "Navigate to Google",
      value: "https://google.com",
      status: "pending" as const,
    };

    await scheduler.executeStep(step);

    expect(mockPage.goto).toHaveBeenCalledWith("https://google.com");
    expect(step.status).toBe("success");
  });

  it("should handle failed steps", async () => {
    mockExecutor.mockRejectedValueOnce(new Error("Click failed"));

    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step: TestStep = {
      id: "step-1",
      index: 0,
      type: "click" as const,
      description: "Click button",
      locator: "button",
      status: "pending" as const,
    };

    await expect(scheduler.executeStep(step)).rejects.toThrow("Click failed");
    expect(step.status).toBe("failure");
    expect(step.error).toBe("Click failed");
  });

  it("should track timing", async () => {
    const scheduler = new StepScheduler(context, mockPlanner, mockExecutor, mockObserver);

    const step: TestStep = {
      id: "step-1",
      index: 0,
      type: "navigate" as const,
      description: "Navigate",
      value: "https://example.com",
      status: "pending" as const,
    };

    await scheduler.executeStep(step);

    expect(step.startedAt).toBeDefined();
    expect(step.completedAt).toBeDefined();
    expect(step.completedAt! >= step.startedAt!).toBe(true);
  });
});

describe("FlowOrchestrator", () => {
  let orchestrator: FlowOrchestrator;
  let mockPage: Page;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn(),
      url: vi.fn(),
      screenshot: vi.fn(),
      waitForSelector: vi.fn(),
    } as any;

    const mockPlanner = vi.fn();
    const mockExecutor = vi.fn();
    const mockObserver = vi.fn().mockResolvedValue({
      id: "obs-1",
      generation: 1,
      text: "Test",
      title: "Test",
      url: "https://example.com",
      elements: [],
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, pageWidth: 1280, pageHeight: 3000 },
    });

    orchestrator = new FlowOrchestrator(
      mockPage,
      { contextWindowSize: 4096, observationBudget: 512, actionBudget: 512 },
      mockPlanner,
      mockExecutor,
      mockObserver
    );
  });

  it("should parse and prepare steps", () => {
    const description = `
      Click button
      Fill box with "text"
      Wait for results
    `;

    const steps = orchestrator.parseAndPrepare(description);

    expect(steps).toHaveLength(3);
    expect(steps[0].type).toBe("click");
    expect(steps[1].type).toBe("fill");
    expect(steps[2].type).toBe("wait");
  });

  it("should manage breakpoints", () => {
    orchestrator.parseAndPrepare("Click button\nWait for results");

    orchestrator.setBreakpoint(1);
    expect(orchestrator.getContext().breakpoints.has(1)).toBe(true);

    orchestrator.clearBreakpoint(1);
    expect(orchestrator.getContext().breakpoints.has(1)).toBe(false);
  });

  it("should retrieve current step", () => {
    orchestrator.parseAndPrepare("Click button\nFill box with 'text'");

    expect(orchestrator.getCurrentStep()?.type).toBe("click");
  });

  it("should manage pause state", async () => {
    expect(orchestrator.getContext().paused).toBe(false);

    orchestrator.getContext().paused = true;
    expect(orchestrator.getContext().paused).toBe(true);

    await orchestrator.resume();
    expect(orchestrator.getContext().paused).toBe(false);
  });
});
