import type { Page } from "playwright";

export type ElementObservation = {
  id: string;
  role?: string;
  name?: string;
  ariaLabel?: string;
  value?: string;
  hasValue?: boolean;
  inputType?: string;
  autocomplete?: string;
  options?: Array<{ label: string; value: string }>;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state: {
    visible: boolean;
    enabled: boolean;
    receivesPointerEvents?: boolean;
    checked?: boolean;
  };
};

export type Observation = {
  id: string;
  generation: number;
  url: string;
  title: string;
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    pageWidth: number;
    pageHeight: number;
  };
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
      const intersectsViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      let receivesPointerEvents = style.pointerEvents !== "none" && intersectsViewport;
      if (visible && receivesPointerEvents && intersectsViewport) {
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        receivesPointerEvents = Boolean(hit && (hit === el || el.contains(hit)));
      }
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
      const ariaDescription = el.getAttribute("aria-description") || "";
      const title = el.getAttribute("title") || "";
      const text = (el.textContent || "").trim();
      const placeholder = (el as HTMLInputElement).placeholder || "";
      const labelText = "labels" in el
        ? Array.from((el as HTMLInputElement).labels ?? [])
            .map((label) => (label.textContent || "").trim())
            .find((v) => v.length > 0) || ""
        : "";
      const nestedTitle = (el.querySelector("svg title")?.textContent || "").trim();
      const name = ([aria, labelText, title, ariaDescription, text, placeholder, nestedTitle]
        .find((v) => v.length > 0) || tag).slice(0, 240);
      // Password values must never cross the browser observation boundary.
      const value = "value" in el && inputType !== "password" ? String((el as HTMLInputElement).value ?? "") : undefined;
      const hasValue = "value" in el ? String((el as HTMLInputElement).value ?? "").length > 0 : undefined;
      const options = tag === "select"
        ? Array.from((el as HTMLSelectElement).options).map((option) => ({ label: option.text.trim(), value: option.value }))
        : undefined;
      const disabled = "disabled" in el ? Boolean((el as HTMLInputElement).disabled) : el.getAttribute("aria-disabled") === "true";
      const checked = "checked" in el ? Boolean((el as HTMLInputElement).checked) : undefined;
      return {
        id,
        role,
        name,
        ariaLabel: aria || undefined,
        value,
        hasValue,
        inputType,
        autocomplete: el.getAttribute("autocomplete") || undefined,
        options,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        state: {
          visible,
          enabled: !disabled,
          receivesPointerEvents,
          checked,
        },
      };
    }).filter((element) => element.state.visible && element.state.receivesPointerEvents);

    const pageText = (document.body?.innerText || "").slice(0, 2500);

    return {
      id: observationId,
      generation,
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        pageWidth: Math.max(
          window.innerWidth,
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0
        ),
        pageHeight: Math.max(
          window.innerHeight,
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0
        ),
      },
      text: pageText,
      elements,
    };
  });

  return data as RawObservation;
}
