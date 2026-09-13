import { describe, expect, it } from "vitest";
import { validateAction } from "../../packages/core/actions.js";
import type { Observation } from "../../packages/core/observer.js";

const observation: Observation = {
  id: "obs-1",
  generation: 1,
  url: "http://localhost:3000/",
  title: "Projects",
  text: "Projects",
  elements: [
    { id: "e1", role: "button", name: "New Project", state: { visible: true, enabled: true } },
    { id: "e2", role: "textbox", name: "Project Name", value: "", state: { visible: true, enabled: true } },
    { id: "e3", role: "button", name: "Delete Project", state: { visible: true, enabled: true } },
  ],
};

describe("validateAction", () => {
  it("rejects stale observation targets", () => {
    expect(() => validateAction({ type: "click", target: { observationId: "obs-0", elementId: "e1" } }, observation)).toThrow("stale observation");
  });

  it("rejects navigation outside the allowed origin", () => {
    expect(() => validateAction({ type: "goto", url: "https://example.com" }, observation, { allowedOrigins: ["http://localhost:3000"] })).toThrow("not allowed");
  });

  it("rejects filling a non-editable target", () => {
    expect(() => validateAction({ type: "fill", target: { observationId: "obs-1", elementId: "e1" }, value: "Demo" }, observation)).toThrow("editable textbox");
  });

  it("requires approval for destructive actions", () => {
    expect(() => validateAction({ type: "click", target: { observationId: "obs-1", elementId: "e3" } }, observation)).toThrow("Destructive action requires approval");
  });
});
