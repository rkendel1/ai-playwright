import type { Page } from "playwright";

export type ObservedElement = {
  id: string;
  role: string;
  name: string;
  value?: string;
};

export type Observation = {
  url: string;
  title: string;
  text: string;
  elements: ObservedElement[];
};

type RawObservedElement = {
  id: string;
  role: string;
  name: string;
  value?: string;
};

export async function observe(page: Page): Promise<Observation> {
  const data = await page.evaluate(() => {
    const selectors = "button, input, textarea, select, a, [role='button'], [role='link'], [role='textbox'], [role='combobox']";
    const all = Array.from(document.querySelectorAll<HTMLElement>(selectors));

    const visible = all.filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const elements = visible.map((el, index) => {
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
      return { id, role, name, value };
    });

    const pageText = (document.body?.innerText || "").slice(0, 4000);

    return {
      url: window.location.href,
      title: document.title,
      text: pageText,
      elements,
    };
  });

  return data as { url: string; title: string; text: string; elements: RawObservedElement[] };
}
