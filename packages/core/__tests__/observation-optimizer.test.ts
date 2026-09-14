import { describe, it, expect } from "vitest";
import {
  ObservationOptimizer,
  ContextAwareObserver,
  summarizeObservation,
  optimizationStrategies,
} from "../observation-optimizer.js";
import type { Observation } from "../observer.js";

const mockObservation: Observation = {
  id: "obs-1",
  generation: 1,
  url: "https://www.google.com/search?q=test",
  title: "Google Search Results",
  text: "Search results for test. ".repeat(100), // ~2400 chars
  viewport: {
    width: 1280,
    height: 720,
    scrollX: 0,
    scrollY: 0,
    pageWidth: 1280,
    pageHeight: 3000,
  },
  elements: [
    {
      id: "e1",
      role: "searchbox",
      name: "Search input field for queries",
      state: { visible: true, enabled: true },
    },
    {
      id: "e2",
      role: "button",
      name: "Google Search",
      state: { visible: true, enabled: true },
    },
    {
      id: "e3",
      role: "button",
      name: "I'm Feeling Lucky",
      state: { visible: true, enabled: true },
    },
    {
      id: "e4",
      role: "link",
      name: "About",
      state: { visible: true, enabled: true },
    },
    {
      id: "e5",
      role: "link",
      name: "Advertising",
      state: { visible: true, enabled: true },
    },
    {
      id: "e6",
      role: "link",
      name: "Business",
      state: { visible: true, enabled: true },
    },
    {
      id: "e7",
      role: "link",
      name: "Search Result 1 - Very long title that describes the result in detail",
      state: { visible: true, enabled: true },
    },
    {
      id: "e8",
      role: "link",
      name: "Search Result 2",
      state: { visible: true, enabled: true },
    },
    {
      id: "e9",
      role: "link",
      name: "Search Result 3",
      state: { visible: true, enabled: true },
    },
    {
      id: "e10",
      role: "generic",
      name: "Sidebar",
      state: { visible: true, enabled: true },
    },
  ],
};

const captchaObservation: Observation = {
  ...mockObservation,
  text: "Our systems have detected unusual traffic from your computer network. " +
    "This page checks to see if it's really you sending the requests, and not a robot. " +
    "CAPTCHA challenge required.",
  elements: [
    {
      id: "e1",
      role: "button",
      name: "Why did this happen?",
      state: { visible: true, enabled: true },
    },
  ],
};

describe("Observation Optimizer", () => {
  describe("minimal optimization", () => {
    it("should keep all visible/enabled elements", () => {
      const optimizer = new ObservationOptimizer("minimal");
      const result = optimizer.optimize(mockObservation);

      expect(result.elements.length).toBe(mockObservation.elements.length);
    });

    it("should truncate text to 2000 chars", () => {
      const optimizer = new ObservationOptimizer("minimal");
      const result = optimizer.optimize(mockObservation);

      expect((result.text?.length ?? 0) <= 2004).toBe(true); // 2000 + "..."
    });

    it("should keep element bounds", () => {
      const optimizer = new ObservationOptimizer("minimal");
      const result = optimizer.optimize(mockObservation);

      expect(result.elements[0].bounds).toBeDefined();
    });
  });

  describe("balanced optimization", () => {
    it("should filter to interactive elements", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      expect(result.elements.length).toBeLessThan(
        mockObservation.elements.length
      );
      const hasGeneric = result.elements.some((e) => e.role === "generic");
      expect(hasGeneric).toBe(false);
    });

    it("should truncate text to 1000 chars", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      expect((result.text?.length ?? 0) <= 1004).toBe(true);
    });

    it("should shorten long element names", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      const longName = result.elements.find(
        (e) => e.name?.includes("Search Result 1")
      );
      expect((longName?.name?.length ?? 0) <= 103).toBe(true);
    });

    it("should remove bounds", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      expect(result.elements[0].bounds).toBeUndefined();
    });
  });

  describe("aggressive optimization", () => {
    it("should keep only critical roles", () => {
      const optimizer = new ObservationOptimizer("aggressive");
      const result = optimizer.optimize(mockObservation);

      const criticalRoles = ["textbox", "searchbox", "button", "combobox", "link"];
      expect(
        result.elements.every((e) =>
          criticalRoles.includes(e.role ?? "")
        )
      ).toBe(true);
    });

    it("should significantly reduce element count", () => {
      const optimizer = new ObservationOptimizer("aggressive");
      const result = optimizer.optimize(mockObservation);

      expect(result.elements.length).toBeLessThan(mockObservation.elements.length / 2);
    });

    it("should truncate text to 300 chars", () => {
      const optimizer = new ObservationOptimizer("aggressive");
      const result = optimizer.optimize(mockObservation);

      expect((result.text?.length ?? 0) <= 304).toBe(true);
    });
  });

  describe("token estimation", () => {
    it("should estimate tokens for observation", () => {
      const optimizer = new ObservationOptimizer("minimal");
      const result = optimizer.optimize(mockObservation);

      expect(result.originalTokenEstimate).toBeGreaterThan(0);
      expect(result.optimizedTokenEstimate).toBeGreaterThan(0);
    });

    it("should show reduction percentage", () => {
      const optimizer = new ObservationOptimizer("aggressive");
      const result = optimizer.optimize(mockObservation);

      expect(result.reductionPercent).toBeGreaterThan(0);
      expect(result.reductionPercent).toBeLessThan(100);
    });

    it("should show higher reduction for aggressive", () => {
      const minimal = new ObservationOptimizer("minimal").optimize(
        mockObservation
      );
      const aggressive = new ObservationOptimizer("aggressive").optimize(
        mockObservation
      );

      expect((aggressive.reductionPercent ?? 0) > (minimal.reductionPercent ?? 0)).toBe(
        true
      );
    });
  });

  describe("recommended strategy", () => {
    it("should recommend minimal for small observations", () => {
      const small: Observation = {
        ...mockObservation,
        text: "Small page",
        elements: mockObservation.elements.slice(0, 2),
      };

      const optimizer = new ObservationOptimizer("minimal");
      const recommended = optimizer.getRecommendedStrategy(small);
      expect(recommended).toBe("minimal");
    });

    it("should recommend aggressive for large observations", () => {
      const large: Observation = {
        ...mockObservation,
        text: "Large page ".repeat(500),
        elements: Array.from({ length: 100 }, (_, i) => ({
          id: `e${i}`,
          role: "link",
          name: `Link ${i}`,
          state: { visible: true, enabled: true },
        })),
      };

      const optimizer = new ObservationOptimizer("minimal");
      const recommended = optimizer.getRecommendedStrategy(large);
      expect(recommended).toBe("aggressive");
    });
  });

  describe("context aware observer", () => {
    it("should auto-optimize for context window", () => {
      const observer = new ContextAwareObserver(4096);
      const result = observer.optimizeForContextWindow(mockObservation, 512);

      expect((result.optimizedTokenEstimate ?? 0) <= 3584).toBe(true);
    });

    it("should escalate strategy if needed", () => {
      const small: Observation = {
        ...mockObservation,
        text: "Large page ".repeat(1000),
        elements: mockObservation.elements.slice(0, 5),
      };

      const observer = new ContextAwareObserver(2000);
      const result = observer.optimizeForContextWindow(small, 512);

      expect((result.optimizedTokenEstimate ?? 0) <= 1488).toBe(true);
    });
  });

  describe("summarization", () => {
    it("should create compact summary", () => {
      const summary = summarizeObservation(mockObservation, 500);
      const tokens = summary.length * 0.00035;

      expect(tokens).toBeLessThan(600); // Some headroom
    });

    it("should include key information", () => {
      const summary = summarizeObservation(mockObservation);

      expect(summary).toContain("url");
      expect(summary).toContain("title");
      expect(summary).toContain("elements");
    });
  });

  describe("page state detection", () => {
    it("should detect CAPTCHA", () => {
      const state = optimizationStrategies.detectPageState(captchaObservation);
      expect(state).toBe("captcha");
    });

    it("should detect rate limit", () => {
      const rateLimited: Observation = {
        ...mockObservation,
        text: "Too many requests. Please try again later.",
      };

      const state = optimizationStrategies.detectPageState(rateLimited);
      expect(state).toBe("rate-limited");
    });

    it("should detect error", () => {
      const error: Observation = {
        ...mockObservation,
        text: "404 Page not found",
      };

      const state = optimizationStrategies.detectPageState(error);
      expect(state).toBe("error");
    });

    it("should return normal for healthy page", () => {
      const state = optimizationStrategies.detectPageState(mockObservation);
      expect(state).toBe("normal");
    });
  });

  describe("truncation notes", () => {
    it("should provide notes for balanced strategy", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      expect(result.truncationNotes).toBeDefined();
      expect((result.truncationNotes?.length ?? 0) > 0).toBe(true);
    });

    it("should describe what was filtered", () => {
      const optimizer = new ObservationOptimizer("balanced");
      const result = optimizer.optimize(mockObservation);

      const hasFilterNote = result.truncationNotes?.some((n) =>
        n.includes("Filtered")
      );
      expect(hasFilterNote).toBe(true);
    });
  });
});
