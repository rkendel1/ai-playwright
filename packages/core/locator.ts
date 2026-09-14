import { z } from "zod";
import type { ElementObservation, Observation } from "./observer.js";

export type ElementLocator =
  | { type: "id"; elementId: string }
  | { type: "observation"; observationId: string; elementId: string }
  | { type: "role"; role: string; index?: number; label?: string }
  | { type: "text"; text: string; role?: string }
  | { type: "label"; label: string }
  | { type: "placeholder"; placeholder: string }
  | { type: "name"; name: string }
  | { type: "semantic"; intent: "search-input" | "login-form" | "submit-button" | "checkbox" | "dropdown" }
  | { type: "xpath"; xpath: string }
  | { type: "css"; selector: string };

export type ElementMatch = {
  element: ElementObservation;
  confidence: number;
  reason: string;
};

const locatorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("id"), elementId: z.string().min(1) }),
  z.object({
    type: z.literal("observation"),
    observationId: z.string().min(1),
    elementId: z.string().min(1),
  }),
  z.object({
    type: z.literal("role"),
    role: z.string().min(1),
    index: z.number().int().min(0).optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().min(1),
    role: z.string().optional(),
  }),
  z.object({ type: z.literal("label"), label: z.string().min(1) }),
  z.object({ type: z.literal("placeholder"), placeholder: z.string().min(1) }),
  z.object({ type: z.literal("name"), name: z.string().min(1) }),
  z.object({
    type: z.literal("semantic"),
    intent: z.enum(["search-input", "login-form", "submit-button", "checkbox", "dropdown"]),
  }),
  z.object({ type: z.literal("xpath"), xpath: z.string().min(1) }),
  z.object({ type: z.literal("css"), selector: z.string().min(1) }),
]);

export type ValidatedLocator = z.infer<typeof locatorSchema>;

export function validateLocator(locator: unknown): ValidatedLocator {
  return locatorSchema.parse(locator);
}

export function findElementByLocator(
  locator: ValidatedLocator,
  observation: Observation,
  allObservations?: Map<string, Observation>
): ElementMatch | null {
  switch (locator.type) {
    case "id":
      return findById(locator.elementId, observation);
    case "observation":
      return findByObservationAndId(
        locator.observationId,
        locator.elementId,
        observation,
        allObservations
      );
    case "role":
      return findByRole(locator.role, locator.index, locator.label, observation);
    case "text":
      return findByText(locator.text, locator.role, observation);
    case "label":
      return findByLabel(locator.label, observation);
    case "placeholder":
      return findByPlaceholder(locator.placeholder, observation);
    case "name":
      return findByName(locator.name, observation);
    case "semantic":
      return findBySemantic(locator.intent, observation);
    case "xpath":
    case "css":
      return null;
  }
}

function findById(elementId: string, observation: Observation): ElementMatch | null {
  const element = observation.elements.find((e) => e.id === elementId);
  if (!element) return null;
  return {
    element,
    confidence: 1.0,
    reason: "Direct element ID match",
  };
}

function findByObservationAndId(
  observationId: string,
  elementId: string,
  currentObservation: Observation,
  allObservations?: Map<string, Observation>
): ElementMatch | null {
  if (observationId === currentObservation.id) {
    return findById(elementId, currentObservation);
  }
  if (!allObservations || !allObservations.has(observationId)) {
    return null;
  }
  const prevObservation = allObservations.get(observationId)!;
  const element = prevObservation.elements.find((e) => e.id === elementId);
  if (!element) return null;

  const correspondingInCurrent = currentObservation.elements.find(
    (e) => e.role === element.role && e.name === element.name && e.value === element.value
  );
  if (correspondingInCurrent) {
    return {
      element: correspondingInCurrent,
      confidence: 0.9,
      reason: "Element matched by role, name, and value from previous observation",
    };
  }
  return null;
}

function findByRole(
  role: string,
  index: number = 0,
  label?: string,
  observation?: Observation
): ElementMatch | null {
  if (!observation) return null;
  let candidates = observation.elements.filter((e) => e.role === role);

  if (label) {
    candidates = candidates.filter(
      (e) => e.name?.toLowerCase().includes(label.toLowerCase())
    );
  }

  if (index >= candidates.length) return null;
  const element = candidates[index];
  return {
    element,
    confidence: label ? 0.95 : 0.85,
    reason: `Found ${role}${label ? ` with label "${label}"` : ""} at index ${index}`,
  };
}

function findByText(text: string, role?: string, observation?: Observation): ElementMatch | null {
  if (!observation) return null;
  const normalizedText = text.toLowerCase();
  let candidates = observation.elements.filter((e) =>
    e.name?.toLowerCase().includes(normalizedText)
  );

  if (role) {
    candidates = candidates.filter((e) => e.role === role);
  }

  if (candidates.length === 0) return null;
  const element = candidates[0];
  const confidence = element.name === text ? 1.0 : 0.9;
  return {
    element,
    confidence,
    reason: `Element containing text "${text}"${role ? ` with role ${role}` : ""}`,
  };
}

function findByLabel(label: string, observation?: Observation): ElementMatch | null {
  if (!observation) return null;
  const normalizedLabel = label.toLowerCase();
  const candidates = observation.elements.filter(
    (e) =>
      (e.name?.toLowerCase().includes(normalizedLabel) ||
        e.ariaLabel?.toLowerCase().includes(normalizedLabel)) &&
      ["textbox", "combobox", "checkbox", "radio"].includes(e.role ?? "")
  );

  if (candidates.length === 0) return null;
  const element = candidates[0];
  return {
    element,
    confidence: 0.9,
    reason: `Found form field with label containing "${label}"`,
  };
}

function findByPlaceholder(placeholder: string, observation?: Observation): ElementMatch | null {
  if (!observation) return null;
  const normalizedPlaceholder = placeholder.toLowerCase();
  const element = observation.elements.find(
    (e) =>
      e.name?.toLowerCase().includes(normalizedPlaceholder) &&
      (e.role === "textbox" || e.role === "combobox")
  );

  if (!element) return null;
  return {
    element,
    confidence: 0.9,
    reason: `Found input field with placeholder "${placeholder}"`,
  };
}

function findByName(name: string, observation?: Observation): ElementMatch | null {
  if (!observation) return null;
  const normalizedName = name.toLowerCase();
  const candidates = observation.elements.filter((e) =>
    e.name?.toLowerCase().includes(normalizedName)
  );

  if (candidates.length === 0) return null;
  const element = candidates[0];
  const confidence = element.name === name ? 1.0 : 0.85;
  return {
    element,
    confidence,
    reason: `Element with name matching "${name}"`,
  };
}

function findBySemantic(
  intent: "search-input" | "login-form" | "submit-button" | "checkbox" | "dropdown",
  observation?: Observation
): ElementMatch | null {
  if (!observation) return null;

  switch (intent) {
    case "search-input": {
      const candidates = observation.elements.filter(
        (e) =>
          (e.role === "textbox" || e.role === "combobox" || e.role === "searchbox") &&
          (e.name?.toLowerCase().includes("search") ||
            e.ariaLabel?.toLowerCase().includes("search"))
      );
      if (candidates.length === 0) {
        return observation.elements.find((e) => e.role === "searchbox") as ElementMatch || null;
      }
      return {
        element: candidates[0],
        confidence: 0.95,
        reason: "Identified as search input field",
      };
    }

    case "login-form": {
      const element = observation.elements.find(
        (e) =>
          (e.name?.toLowerCase().includes("login") ||
            e.name?.toLowerCase().includes("email") ||
            e.name?.toLowerCase().includes("username")) &&
          ["textbox", "combobox"].includes(e.role ?? "")
      );
      return element
        ? {
            element,
            confidence: 0.85,
            reason: "Identified as login field",
          }
        : null;
    }

    case "submit-button": {
      const candidates = observation.elements.filter(
        (e) =>
          e.role === "button" &&
          (e.name?.toLowerCase().includes("submit") ||
            e.name?.toLowerCase().includes("login") ||
            e.name?.toLowerCase().includes("send") ||
            e.name?.toLowerCase().includes("search"))
      );
      if (candidates.length === 0) {
        const firstButton = observation.elements.find((e) => e.role === "button");
        return firstButton
          ? { element: firstButton, confidence: 0.7, reason: "Fallback to first button" }
          : null;
      }
      return {
        element: candidates[0],
        confidence: 0.95,
        reason: "Identified as submit button",
      };
    }

    case "checkbox": {
      const element = observation.elements.find((e) => e.role === "checkbox");
      return element
        ? {
            element,
            confidence: 0.95,
            reason: "Identified as checkbox",
          }
        : null;
    }

    case "dropdown": {
      const element = observation.elements.find((e) => e.role === "combobox");
      return element
        ? {
            element,
            confidence: 0.95,
            reason: "Identified as dropdown/combobox",
          }
        : null;
    }
  }
}
