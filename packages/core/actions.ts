import { z } from "zod";
import type { Observation } from "./observer.js";

export type Target = { id: string };

export type Assertion =
  | { type: "textVisible"; text: string }
  | { type: "urlIncludes"; value: string };

export type BrowserAction =
  | { type: "goto"; url: string; reason?: string }
  | { type: "click"; target: Target; reason?: string }
  | { type: "fill"; target: Target; value: string; reason?: string }
  | { type: "press"; target: Target; key: string; reason?: string }
  | { type: "select"; target: Target; value: string; reason?: string }
  | { type: "hover"; target: Target; reason?: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number; reason?: string }
  | { type: "wait"; ms: number; reason?: string }
  | { type: "extract"; target: Target; reason?: string }
  | { type: "assert"; assertion: Assertion; reason?: string }
  | { type: "finish"; result: "success"; reason: string }
  | { type: "blocked"; reason: string };

const targetSchema = z.object({ id: z.string().min(1) });
const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("textVisible"), text: z.string().min(1) }),
  z.object({ type: z.literal("urlIncludes"), value: z.string().min(1) }),
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: z.string().url(), reason: z.string().optional() }),
  z.object({ type: z.literal("click"), target: targetSchema, reason: z.string().optional() }),
  z.object({ type: z.literal("fill"), target: targetSchema, value: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("press"), target: targetSchema, key: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("select"), target: targetSchema, value: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("hover"), target: targetSchema, reason: z.string().optional() }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().int().positive().optional(), reason: z.string().optional() }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(10000), reason: z.string().optional() }),
  z.object({ type: z.literal("extract"), target: targetSchema, reason: z.string().optional() }),
  z.object({ type: z.literal("assert"), assertion: assertionSchema, reason: z.string().optional() }),
  z.object({ type: z.literal("finish"), result: z.literal("success"), reason: z.string().min(1) }),
  z.object({ type: z.literal("blocked"), reason: z.string().min(1) }),
]);

export function validateAction(action: BrowserAction, observation: Observation): BrowserAction {
  const parsed = actionSchema.parse(action) as BrowserAction;
  if ("target" in parsed) {
    const hasId = observation.elements.some((element) => element.id === parsed.target.id);
    if (!hasId) {
      throw new Error(`Action target '${parsed.target.id}' does not exist in current observation.`);
    }
  }
  return parsed;
}
