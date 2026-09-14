import { describe, it, expect } from "vitest";
import { validateAction, actionRisk } from "../action-schema.js";

describe("Action Schema", () => {
  describe("validation", () => {
    it("should validate goto action", () => {
      const action = {
        type: "goto",
        url: "https://example.com",
        reason: "Navigate to homepage",
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("goto");
      expect(validated.url).toBe("https://example.com");
    });

    it("should validate click action with semantic locator", () => {
      const action = {
        type: "click",
        locator: {
          type: "semantic",
          intent: "search-input",
        },
        reason: "Click search button",
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("click");
      expect(validated.locator.type).toBe("semantic");
    });

    it("should validate fill action with fallback locators", () => {
      const action = {
        type: "fill",
        locator: { type: "label", label: "Email" },
        value: "test@example.com",
        fallbackLocators: [
          { type: "placeholder", placeholder: "your@email.com" },
          { type: "semantic", intent: "login-form" },
        ],
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("fill");
      expect(validated.value).toBe("test@example.com");
      expect(validated.fallbackLocators).toHaveLength(2);
    });

    it("should validate assert action with text", () => {
      const action = {
        type: "assert",
        assertion: {
          type: "textVisible",
          text: "Welcome to Dashboard",
        },
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("assert");
      expect(validated.assertion.type).toBe("textVisible");
    });

    it("should validate finish action", () => {
      const action = {
        type: "finish",
        result: "success",
        reason: "Task completed successfully",
        confidence: 0.95,
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("finish");
      expect(validated.result).toBe("success");
    });

    it("should validate blocked action", () => {
      const action = {
        type: "blocked",
        reason: "Could not locate search input",
        suggestion: "Try searching with keyboard shortcut",
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("blocked");
    });

    it("should reject invalid URL in goto", () => {
      const action = {
        type: "goto",
        url: "not-a-url",
      };
      expect(() => validateAction(action)).toThrow();
    });

    it("should reject invalid key in press action", () => {
      const action = {
        type: "press",
        locator: { type: "id", elementId: "e1" },
        key: "",
      };
      expect(() => validateAction(action)).toThrow();
    });

    it("should support all locator types", () => {
      const locators = [
        { type: "id", elementId: "e1" },
        { type: "observation", observationId: "obs-1", elementId: "e1" },
        { type: "role", role: "button", index: 0, label: "Submit" },
        { type: "text", text: "Click me", role: "button" },
        { type: "label", label: "Email" },
        { type: "placeholder", placeholder: "Enter email" },
        { type: "name", name: "username" },
        { type: "semantic", intent: "search-input" as const },
      ];

      for (const locator of locators) {
        const action = { type: "click", locator };
        expect(() => validateAction(action)).not.toThrow();
      }
    });
  });

  describe("action risk", () => {
    it("should classify read actions", () => {
      const action = { type: "scroll", direction: "down" } as any;
      expect(actionRisk(action)).toBe("read");
    });

    it("should classify write actions", () => {
      const action = { type: "click", locator: {} } as any;
      expect(actionRisk(action)).toBe("write");
    });

    it("should classify destructive actions", () => {
      const action = { type: "click", locator: {} } as any;
      const element = { name: "Delete Account", role: "button" } as any;
      expect(actionRisk(action, element)).toBe("destructive");
    });

    it("should respect explicit risk override", () => {
      const action = {
        type: "click",
        locator: {},
        risk: "destructive" as const,
      } as any;
      expect(actionRisk(action)).toBe("destructive");
    });
  });
});
