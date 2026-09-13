import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserRuntime } from "../core/runtime.js";

export type ObscuraRuntimeOptions = {
  obscuraCommand?: string;
  cdpPort?: number;
  allowPrivateNetwork?: boolean;
  fallbackToPlaywrightChromium?: boolean;
};

async function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to acquire a local port for Obscura CDP."));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForCdp(port: number, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Keep retrying until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Obscura CDP endpoint on port ${port}.`);
}

function commandExists(command: string): boolean {
  const isAbsoluteOrRelative = command.includes("/") || command.includes("\\");
  if (isAbsoluteOrRelative) {
    return fs.existsSync(command);
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  return pathEntries.some((entry) => {
    return extensions.some((ext) => fs.existsSync(path.join(entry, `${command}${ext}`)));
  });
}

export class ObscuraRuntime implements BrowserRuntime {
  private browser?: Browser;
  private context?: BrowserContext;
  private runtimePage?: Page;
  private obscuraProcess?: ChildProcessWithoutNullStreams;

  constructor(
    private readonly headless = true,
    private readonly options: ObscuraRuntimeOptions = {},
  ) {}

  async launch(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const command = this.options.obscuraCommand ?? "obscura";
    const port = this.options.cdpPort ?? (await findOpenPort());
    const allowPrivateNetwork = this.options.allowPrivateNetwork ?? true;
    const fallbackToPlaywrightChromium = this.options.fallbackToPlaywrightChromium ?? true;

    const args = ["serve", "--port", String(port)];
    if (allowPrivateNetwork) {
      args.push("--allow-private-network");
    }

    try {
      if (!commandExists(command)) {
        throw new Error(`Command '${command}' not found.`);
      }
      this.obscuraProcess = spawn(command, args, { stdio: "pipe" });
      this.obscuraProcess.once("error", () => {
        // handled by waitForCdp timeout and fallback path
      });
      await waitForCdp(port);
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      if (this.obscuraProcess && !this.obscuraProcess.killed) {
        this.obscuraProcess.kill("SIGTERM");
        this.obscuraProcess = undefined;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!fallbackToPlaywrightChromium) {
        if (message.includes("not found")) {
          throw new Error(
            `Failed to launch Obscura via '${command}': command not found. Install Obscura and ensure it is available on PATH.`,
          );
        }
        throw new Error(`Failed to launch Obscura via '${command}': ${message}`);
      }
      this.browser = await chromium.launch({ headless: this.headless });
    }

    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    this.runtimePage = await this.context.newPage();

    return {
      browser: this.browser,
      context: this.context,
      page: this.runtimePage,
    };
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    if (this.obscuraProcess && !this.obscuraProcess.killed) {
      this.obscuraProcess.kill("SIGTERM");
    }
  }
}
