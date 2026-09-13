import { z } from "zod";
import type { ElementObservation, Observation } from "./observer.js";

export type Target = { observationId: string; elementId: string };
export type ActionRisk = "read" | "write" | "destructive";

export type Assertion =
  | { type: "textVisible"; text: string }
  | { type: "urlIncludes"; value: string };

type ActionMeta = {
  reason?: string;
  confidence?: number;
  risk?: ActionRisk;
};

export type BrowserAction =
  | ({ type: "goto"; url: string } & ActionMeta)
  | ({ type: "click"; target: Target } & ActionMeta)
  | ({ type: "fill"; target: Target; value: string } & ActionMeta)
  | ({ type: "press"; target: Target; key: string } & ActionMeta)
  | ({ type: "select"; target: Target; value: string } & ActionMeta)
  | ({ type: "hover"; target: Target } & ActionMeta)
  | ({ type: "scroll"; direction: "up" | "down"; amount?: number } & ActionMeta)
  | ({ type: "wait"; ms: number } & ActionMeta)
  | ({ type: "extract"; target: Target } & ActionMeta)
  | ({ type: "assert"; assertion: Assertion } & ActionMeta)
  | ({ type: "finish"; result: "success"; reason: string } & Pick<ActionMeta, "confidence" | "risk">)
  | ({ type: "blocked"; reason: string } & Pick<ActionMeta, "confidence" | "risk">);

export type ActionPolicy = {
  allowedOrigins?: string[];
  approval?: "never" | "destructive" | "all";
  allowedKeys?: string[];
};

const actionMetaSchema = {
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  risk: z.enum(["read", "write", "destructive"]).optional(),
};

const targetSchema = z.object({
  observationId: z.string().min(1),
  elementId: z.string().min(1),
});
const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("textVisible"), text: z.string().min(1) }),
  z.object({ type: z.literal("urlIncludes"), value: z.string().min(1) }),
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: z.string().url(), ...actionMetaSchema }),
  z.object({ type: z.literal("click"), target: targetSchema, ...actionMetaSchema }),
  z.object({ type: z.literal("fill"), target: targetSchema, value: z.string(), ...actionMetaSchema }),
  z.object({ type: z.literal("press"), target: targetSchema, key: z.string().min(1), ...actionMetaSchema }),
  z.object({ type: z.literal("select"), target: targetSchema, value: z.string(), ...actionMetaSchema }),
  z.object({ type: z.literal("hover"), target: targetSchema, ...actionMetaSchema }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().int().positive().optional(), ...actionMetaSchema }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(10000), ...actionMetaSchema }),
  z.object({ type: z.literal("extract"), target: targetSchema, ...actionMetaSchema }),
  z.object({ type: z.literal("assert"), assertion: assertionSchema, ...actionMetaSchema }),
  z.object({ type: z.literal("finish"), result: z.literal("success"), reason: z.string().min(1), confidence: actionMetaSchema.confidence, risk: actionMetaSchema.risk }),
  z.object({ type: z.literal("blocked"), reason: z.string().min(1), confidence: actionMetaSchema.confidence, risk: actionMetaSchema.risk }),
]);

function findTarget(action: BrowserAction, observation: Observation): ElementObservation | undefined {
  if (!("target" in action)) return undefined;
  if (action.target.observationId !== observation.id) {
    throw new Error(
      `Action target was planned from stale observation '${action.target.observationId}'. Current observation is '${observation.id}'.`,
    );
  }
  const element = observation.elements.find((entry) => entry.id === action.target.elementId);
  if (!element) {
    throw new Error(`Action target '${action.target.elementId}' does not exist in current observation.`);
  }
  return element;
}

function assertInteractive(action: BrowserAction, element: ElementObservation) {
  if (!element.state.visible) {
    throw new Error(`Action target '${element.id}' is not visible.`);
  }
  if (!element.state.enabled) {
    throw new Error(`Action target '${element.id}' is not enabled.`);
  }
  if (action.type === "fill" && !["textbox", "searchbox"].includes(element.role ?? "")) {
    throw new Error(`Fill target '${element.id}' must be an editable textbox.`);
  }
  if (action.type === "select" && element.role !== "combobox") {
    throw new Error(`Select target '${element.id}' must be a select or combobox.`);
  }
}

function actionRisk(action: BrowserAction, element?: ElementObservation): ActionRisk {
  if (action.risk) return action.risk;
  if (["goto", "click", "fill", "press", "select"].includes(action.type)) {
    const name = element?.name ?? "";
    if (/delete|remove|destroy|purchase|pay|publish|send/i.test(name)) return "destructive";
    return "write";
  }
  return "read";
}

function validateNavigation(url: string, policy: ActionPolicy) {
  if (!policy.allowedOrigins?.length) return;
  const origin = new URL(url).origin;
  if (!policy.allowedOrigins.includes(origin)) {
    throw new Error(`Navigation to origin '${origin}' is not allowed by policy.`);
  }
}

function validateApproval(action: BrowserAction, element: ElementObservation | undefined, policy: ActionPolicy) {
  const approval = policy.approval ?? "destructive";
  const risk = actionRisk(action, element);
  if (approval === "destructive" && risk === "destructive") {
    throw new Error("Destructive action requires approval.");
  }
  if (approval === "all" && risk !== "read") {
    throw new Error("Action requires approval.");
  }
}

function validateKey(action: BrowserAction, policy: ActionPolicy) {
  if (action.type !== "press") return;
  const allowed = policy.allowedKeys ?? ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!allowed.includes(action.key)) {
    throw new Error(`Key '${action.key}' is not allowed by policy.`);
  }
}

export function validateAction(action: unknown, observation: Observation, policy: ActionPolicy = {}): BrowserAction {
  const parsed = actionSchema.parse(action) as BrowserAction;
  const element = findTarget(parsed, observation);

  if (parsed.type === "goto") {
    validateNavigation(parsed.url, policy);
  }
  if (["click", "fill", "press", "select", "hover", "extract"].includes(parsed.type) && element) {
    assertInteractive(parsed, element);
  }
  validateKey(parsed, policy);
  validateApproval(parsed, element, policy);
  return parsed;
}
