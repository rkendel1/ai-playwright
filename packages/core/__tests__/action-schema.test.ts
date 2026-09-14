import { describe, it, expect } from "vitest";
import { validateAction, actionRisk } from "../action-schema.js";

describe("Action Schema", () => {
  describe("validation", () => {
    it("should validate goto action", () => {
      const action = {
        type: "goto" as const,
        url: "https://example.com",
        reason: "Navigate to homepage",
      };
      const validated = validateAction(action);
      expect(validated).toMatchObject({ type: "goto", url: "https://example.com" });
    });

    it("should validate click action with semantic locator", () => {
      const action = {
        type: "click" as const,
        locator: {
          type: "semantic" as const,
          intent: "search-input" as const,
        },
        reason: "Click search button",
      };
      const validated = validateAction(action);
      expect(validated).toMatchObject({ type: "click", locator: { type: "semantic" } });
    });

    it("should validate fill action with fallback locators", () => {
      const action = {
        type: "fill" as const,
        locator: { type: "label" as const, label: "Email" },
        value: "test@example.com",
        fallbackLocators: [
          { type: "placeholder" as const, placeholder: "your@email.com" },
        ],
      };
      const validated = validateAction(action);
      expect(validated).toMatchObject({ type: "fill", value: "test@example.com" });
      expect("fallbackLocators" in validated ? validated.fallbackLocators : []).toHaveLength(1);
    });

    it("should validate assert action with text", () => {
      const action = {
        type: "assert" as const,
        assertion: {
          type: "textVisible" as const,
          text: "Welcome to Dashboard",
        },
      };
      const validated = validateAction(action);
      expect(validated).toMatchObject({ type: "assert", assertion: { type: "textVisible" } });
    });

    it("should validate finish action", () => {
      const action = {
        type: "finish" as const,
        result: "success" as const,
        reason: "Task completed successfully",
        confidence: 0.95,
      };
      const validated = validateAction(action);
      expect(validated).toMatchObject({ type: "finish", result: "success" });
    });

    it("should validate blocked action", () => {
      const action = {
        type: "blocked" as const,
        reason: "Could not locate search input",
        suggestion: "Try searching with keyboard shortcut",
      };
      const validated = validateAction(action);
      expect(validated.type).toBe("blocked");
    });

    it("should reject invalid URL in goto", () => {
      const action = {
        type: "goto" as const,
        url: "not-a-url",
      };
      expect(() => validateAction(action)).toThrow();
    });

    it("should reject invalid key in press action", () => {
      const action = {
        type: "press" as const,
        locator: { type: "text" as const, selector: "button" },
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
