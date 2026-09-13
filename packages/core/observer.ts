import type { Page } from "playwright";

export type ElementObservation = {
  id: string;
  role?: string;
  name?: string;
  value?: string;
  state: {
    visible: boolean;
    enabled: boolean;
    checked?: boolean;
  };
};

export type Observation = {
  id: string;
  generation: number;
  url: string;
  title: string;
  elements: ElementObservation[];
  text?: string;
};

type RawElementObservation = ElementObservation;

type RawObservation = {
  id: string;
  generation: number;
  url: string;
  title: string;
  text?: string;
  elements: RawElementObservation[];
};

export async function observe(page: Page): Promise<Observation> {
  const data = await page.evaluate(() => {
    const win = window as typeof window & { __aipwObservationGeneration?: number };
    win.__aipwObservationGeneration = (win.__aipwObservationGeneration ?? 0) + 1;
    const generation = win.__aipwObservationGeneration;
    const observationId = `obs-${generation}`;
    const selectors = "button, input, textarea, select, a, [role='button'], [role='link'], [role='textbox'], [role='combobox']";
    const all = Array.from(document.querySelectorAll<HTMLElement>(selectors));

    const elements = all.map((el, index) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible = style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      const id = el.dataset.aipwId ?? `e${index + 1}`;
      el.dataset.aipwId = id;
      const tag = el.tagName.toLowerCase();
      const inputType = tag === "input" ? ((el as HTMLInputElement).type || "text").toLowerCase() : undefined;
      const role = el.getAttribute("role") || (() => {
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          if (["button", "submit", "reset"].includes(inputType ?? "")) return "button";
          if (["checkbox"].includes(inputType ?? "")) return "checkbox";
          if (["radio"].includes(inputType ?? "")) return "radio";
          return "textbox";
        }
        return tag;
      })();
      const aria = el.getAttribute("aria-label") || "";
      const text = (el.textContent || "").trim();
      const placeholder = (el as HTMLInputElement).placeholder || "";
      const labelText = "labels" in el
        ? Array.from((el as HTMLInputElement).labels ?? [])
            .map((label) => (label.textContent || "").trim())
            .find((v) => v.length > 0) || ""
        : "";
      const name = [aria, labelText, text, placeholder].find((v) => v.length > 0) || tag;
      const value = "value" in el ? String((el as HTMLInputElement).value ?? "") : undefined;
      const disabled = "disabled" in el ? Boolean((el as HTMLInputElement).disabled) : el.getAttribute("aria-disabled") === "true";
      const checked = "checked" in el ? Boolean((el as HTMLInputElement).checked) : undefined;
      return {
        id,
        role,
        name,
        value,
        state: {
          visible,
          enabled: !disabled,
          checked,
        },
      };
    }).filter((element) => element.state.visible);

    const pageText = (document.body?.innerText || "").slice(0, 4000);

    return {
      id: observationId,
      generation,
      url: window.location.href,
      title: document.title,
      text: pageText,
      elements,
    };
  });

  return data as RawObservation;
}
