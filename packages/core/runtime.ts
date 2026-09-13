import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserRuntime {
  launch(): Promise<{ browser: Browser; context: BrowserContext; page: Page }>;
  close(): Promise<void>;
}
