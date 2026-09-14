import { describe, it, expect } from "vitest";
import {
  findElementByLocator,
  validateLocator,
  type ElementMatch,
} from "../locator.js";
import type { Observation } from "../observer.js";

describe("Element Locator System", () => {
  const mockObservation: Observation = {
    id: "obs-1",
    generation: 1,
    url: "https://example.com",
    title: "Example",
    viewport: {
      width: 1024,
      height: 768,
      scrollX: 0,
      scrollY: 0,
      pageWidth: 1024,
      pageHeight: 1500,
    },
    elements: [
      {
        id: "e1",
        role: "searchbox",
        name: "Search",
        ariaLabel: "Search for items",
        state: { visible: true, enabled: true },
      },
      {
        id: "e2",
        role: "button",
        name: "Submit Search",
        state: { visible: true, enabled: true },
      },
      {
        id: "e3",
        role: "textbox",
        name: "Email Address",
        ariaLabel: "Enter your email",
        state: { visible: true, enabled: true },
      },
      {
        id: "e4",
        role: "combobox",
        name: "Select Country",
        options: [
          { label: "USA", value: "us" },
          { label: "Canada", value: "ca" },
        ],
        state: { visible: true, enabled: true },
      },
      {
        id: "e5",
        role: "checkbox",
        name: "Agree to terms",
        state: { visible: true, enabled: true, checked: false },
      },
    ],
  };

  describe("validation", () => {
    it("should validate id locator", () => {
      const locator = validateLocator({ type: "id", elementId: "e1" });
      expect(locator.type).toBe("id");
    });

    it("should validate semantic locator", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "search-input",
      });
      expect(locator.type).toBe("semantic");
    });

    it("should reject invalid locator", () => {
      expect(() =>
        validateLocator({ type: "invalid" } as any)
      ).toThrow();
    });
  });

  describe("id locator", () => {
    it("should find element by id", () => {
      const locator = validateLocator({ type: "id", elementId: "e1" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e1");
      expect(match?.confidence).toBe(1.0);
    });

    it("should return null for non-existent id", () => {
      const locator = validateLocator({ type: "id", elementId: "e999" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).toBeNull();
    });
  });

  describe("role locator", () => {
    it("should find element by role", () => {
      const locator = validateLocator({ type: "role", role: "button" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.role).toBe("button");
    });

    it("should find element by role and index", () => {
      const locator = validateLocator({
        type: "role",
        role: "textbox",
        index: 0,
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e3");
    });

    it("should find element by role and label", () => {
      const locator = validateLocator({
        type: "role",
        role: "textbox",
        label: "Email",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match?.element.name).toContain("Email");
      expect(match?.confidence).toBeGreaterThan(0.9);
    });
  });

  describe("text locator", () => {
    it("should find element by text", () => {
      const locator = validateLocator({
        type: "text",
        text: "Submit Search",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e2");
    });

    it("should find element by partial text", () => {
      const locator = validateLocator({ type: "text", text: "Submit" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.confidence).toBeLessThan(1.0);
    });

    it("should return null for non-existent text", () => {
      const locator = validateLocator({ type: "text", text: "Nonexistent" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).toBeNull();
    });
  });

  describe("label locator", () => {
    it("should find form field by label", () => {
      const locator = validateLocator({ type: "label", label: "Email" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.name).toContain("Email");
    });

    it("should only match form fields", () => {
      const locator = validateLocator({
        type: "label",
        label: "Submit",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).toBeNull();
    });
  });

  describe("placeholder locator", () => {
    it("should find input by placeholder text", () => {
      // Add element with placeholder
      const obsWithPlaceholder: Observation = {
        ...mockObservation,
        elements: [
          ...mockObservation.elements,
          {
            id: "e6",
            role: "textbox",
            name: "Search queries...",
            state: { visible: true, enabled: true },
          },
        ],
      };

      const locator = validateLocator({
        type: "placeholder",
        placeholder: "Search",
      });
      const match = findElementByLocator(locator, obsWithPlaceholder);
      expect(match).not.toBeNull();
    });
  });

  describe("semantic locator", () => {
    it("should find search input", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "search-input",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e1");
      expect(match?.confidence).toBeGreaterThan(0.9);
    });

    it("should find submit button", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "submit-button",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.role).toBe("button");
    });

    it("should find dropdown", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "dropdown",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e4");
    });

    it("should find checkbox", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "checkbox",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e5");
    });

    it("should find login form", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "login-form",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match).not.toBeNull();
    });
  });

  describe("confidence scoring", () => {
    it("should give higher confidence to exact matches", () => {
      const exactMatch = validateLocator({
        type: "text",
        text: "Submit Search",
      });
      const partialMatch = validateLocator({
        type: "text",
        text: "Submit",
      });

      const exact = findElementByLocator(exactMatch, mockObservation);
      const partial = findElementByLocator(partialMatch, mockObservation);

      expect(exact?.confidence).toBe(1.0);
      expect((partial?.confidence ?? 0) < (exact?.confidence ?? 0)).toBe(true);
    });

    it("should score semantic matches appropriately", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "search-input",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect((match?.confidence ?? 0) >= 0.85).toBe(true);
    });
  });

  describe("fallback resolution", () => {
    it("should suggest fallbacks in match reason", () => {
      const locator = validateLocator({
        type: "semantic",
        intent: "search-input",
      });
      const match = findElementByLocator(locator, mockObservation);
      expect(match?.reason).toContain("search");
    });
  });

  describe("edge cases", () => {
    it("should handle empty observation", () => {
      const emptyObs: Observation = {
        id: "obs-empty",
        generation: 1,
        url: "https://example.com",
        title: "Empty",
        elements: [],
      };

      const locator = validateLocator({ type: "role", role: "button" });
      const match = findElementByLocator(locator, emptyObs);
      expect(match).toBeNull();
    });

    it("should handle case-insensitive name matching", () => {
      const locator = validateLocator({ type: "text", text: "SEARCH" });
      const match = findElementByLocator(locator, mockObservation);
      expect(match?.element.name?.toLowerCase()).toContain("search");
    });

    it("should handle multiple candidates", () => {
      const obsWithDuplicates: Observation = {
        ...mockObservation,
        elements: [
          ...mockObservation.elements,
          {
            id: "e7",
            role: "button",
            name: "Submit",
            state: { visible: true, enabled: true },
          },
        ],
      };

      const locator = validateLocator({ type: "role", role: "button" });
      const match = findElementByLocator(locator, obsWithDuplicates);
      expect(match).not.toBeNull();
      expect(match?.element.id).toBe("e2");
    });
  });
});
