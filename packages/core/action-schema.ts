import { z } from "zod";
import type { ElementLocator } from "./locator.js";
import type { ElementObservation, Observation } from "./observer.js";

export type ActionRisk = "read" | "write" | "destructive";

export type Assertion =
  | { type: "textVisible"; text: string }
  | { type: "urlIncludes"; value: string }
  | { type: "elementVisible"; elementId: string }
  | { type: "elementEnabled"; elementId: string };

export type ActionMeta = {
  reason?: string;
  confidence?: number;
  risk?: ActionRisk;
  recordedFrom?: string;
};

export type BrowserAction =
  | ({
      type: "goto";
      url: string;
      fallbacks?: string[];
    } & ActionMeta)
  | ({
      type: "click";
      locator: ElementLocator;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "fill";
      locator: ElementLocator;
      value: string;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "press";
      locator: ElementLocator;
      key: string;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "select";
      locator: ElementLocator;
      value: string;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "hover";
      locator: ElementLocator;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "scroll";
      direction: "up" | "down";
      amount?: number;
    } & ActionMeta)
  | ({
      type: "wait";
      ms: number;
    } & ActionMeta)
  | ({
      type: "extract";
      locator: ElementLocator;
      fallbackLocators?: ElementLocator[];
    } & ActionMeta)
  | ({
      type: "assert";
      assertion: Assertion;
    } & ActionMeta)
  | ({
      type: "finish";
      result: "success" | "failure";
      reason: string;
      evidence?: string;
    } & Pick<ActionMeta, "confidence" | "risk">)
  | ({
      type: "blocked";
      reason: string;
      suggestion?: string;
    } & Pick<ActionMeta, "confidence" | "risk">);

export type ActionPolicy = {
  allowedOrigins?: string[];
  approval?: "never" | "destructive" | "all";
  allowedKeys?: string[];
};

const locatorSchema = z.object({
  type: z.enum([
    "id",
    "observation",
    "role",
    "text",
    "label",
    "placeholder",
    "name",
    "semantic",
    "xpath",
    "css",
  ]),
}) as z.ZodSchema<ElementLocator>;

const actionMetaSchema = {
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  risk: z.enum(["read", "write", "destructive"]).optional(),
  recordedFrom: z.string().optional(),
};

const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("textVisible"), text: z.string().min(1) }),
  z.object({ type: z.literal("urlIncludes"), value: z.string().min(1) }),
  z.object({ type: z.literal("elementVisible"), elementId: z.string().min(1) }),
  z.object({ type: z.literal("elementEnabled"), elementId: z.string().min(1) }),
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goto"),
    url: z.string().url(),
    fallbacks: z.array(z.string().url()).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("click"),
    locator: locatorSchema,
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("fill"),
    locator: locatorSchema,
    value: z.string(),
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("press"),
    locator: locatorSchema,
    key: z.string().min(1),
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("select"),
    locator: locatorSchema,
    value: z.string(),
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("hover"),
    locator: locatorSchema,
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive().optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().min(0).max(30000),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("extract"),
    locator: locatorSchema,
    fallbackLocators: z.array(locatorSchema).optional(),
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("assert"),
    assertion: assertionSchema,
    ...actionMetaSchema,
  }),
  z.object({
    type: z.literal("finish"),
    result: z.enum(["success", "failure"]),
    reason: z.string().min(1),
    evidence: z.string().optional(),
    confidence: actionMetaSchema.confidence,
    risk: actionMetaSchema.risk,
  }),
  z.object({
    type: z.literal("blocked"),
    reason: z.string().min(1),
    suggestion: z.string().optional(),
    confidence: actionMetaSchema.confidence,
    risk: actionMetaSchema.risk,
  }),
]);

export type ValidatedAction = z.infer<typeof actionSchema>;

export function validateAction(action: unknown): ValidatedAction {
  return actionSchema.parse(action);
}

export function actionRisk(action: BrowserAction, element?: ElementObservation): ActionRisk {
  if (action.risk) return action.risk;
  if (["goto", "click", "fill", "press", "select"].includes(action.type)) {
    const name = element?.name ?? "";
    if (/delete|remove|destroy|purchase|pay|publish|send/i.test(name)) return "destructive";
    return "write";
  }
  return "read";
}

export function validateNavigation(url: string, policy: ActionPolicy) {
  if (!policy.allowedOrigins?.length) return;
  const origin = new URL(url).origin;
  if (!policy.allowedOrigins.includes(origin)) {
    throw new Error(`Navigation to origin '${origin}' is not allowed by policy.`);
  }
}

export function validateApproval(action: BrowserAction, element: ElementObservation | undefined, policy: ActionPolicy) {
  const approval = policy.approval ?? "destructive";
  const risk = actionRisk(action, element);
  if (approval === "destructive" && risk === "destructive") {
    throw new Error("Destructive action requires approval.");
  }
  if (approval === "all" && risk !== "read") {
    throw new Error("Action requires approval.");
  }
}

export function validateKey(action: BrowserAction, policy: ActionPolicy) {
  if (action.type !== "press") return;
  const allowed = policy.allowedKeys ?? [
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];
  if (!allowed.includes(action.key)) {
    throw new Error(`Key '${action.key}' is not allowed by policy.`);
  }
}
