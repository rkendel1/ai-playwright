import type { Page } from "playwright";
import type { BrowserAction } from "./actions.js";
import type { Observation } from "./observer.js";

export type ActionResult = {
  status: "success" | "failure";
  error?: string;
  output?: string;
};

export interface BrowserExecutor {
  execute(page: Page, action: BrowserAction, observation: Observation): Promise<ActionResult>;
}

async function resolveLocator(page: Page, elementId: string) {
  const locator = page.locator(`[data-aipw-id='${elementId}']`).first();
  await locator.waitFor({ state: "visible", timeout: 5000 });
  return locator;
}

export class PlaywrightExecutor implements BrowserExecutor {
  async execute(page: Page, action: BrowserAction): Promise<ActionResult> {
    try {
      switch (action.type) {
        case "goto":
          await page.goto(action.url, { waitUntil: "domcontentloaded" });
          return { status: "success" };
        case "click":
          await (await resolveLocator(page, action.target.elementId)).click({ timeout: 5000 });
          return { status: "success" };
        case "fill":
          await (await resolveLocator(page, action.target.elementId)).fill(action.value, { timeout: 5000 });
          return { status: "success" };
        case "press":
          await (await resolveLocator(page, action.target.elementId)).press(action.key, { timeout: 5000 });
          return { status: "success" };
        case "select":
          await (await resolveLocator(page, action.target.elementId)).selectOption(action.value, { timeout: 5000 });
          return { status: "success" };
        case "hover":
          await (await resolveLocator(page, action.target.elementId)).hover({ timeout: 5000 });
          return { status: "success" };
        case "scroll":
          await page.mouse.wheel(0, (action.amount ?? 300) * (action.direction === "down" ? 1 : -1));
          return { status: "success" };
        case "wait":
          await page.waitForTimeout(action.ms);
          return { status: "success" };
        case "extract": {
          const text = await (await resolveLocator(page, action.target.elementId)).innerText();
          return { status: "success", output: text };
        }
        case "assert": {
          if (action.assertion.type === "textVisible") {
            const bodyText = await page.locator("body").innerText();
            if (bodyText.includes(action.assertion.text)) {
              return { status: "success", output: action.assertion.text };
            }
            return { status: "failure", error: `Expected text '${action.assertion.text}' to be visible.` };
          }

          if (action.assertion.type === "urlIncludes") {
            if (page.url().includes(action.assertion.value)) {
              return { status: "success", output: action.assertion.value };
            }
            return { status: "failure", error: `Expected URL to include '${action.assertion.value}'.` };
          }
          return { status: "failure", error: "Unknown assertion type." };
        }
        case "finish":
        case "blocked":
          return { status: "success" };
        default:
          return { status: "failure", error: `Unsupported action type ${(action as { type: string }).type}` };
      }
    } catch (error) {
      return {
        status: "failure",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
