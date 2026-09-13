import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type WorkspaceConfig = {
  url?: string;
  browser?: "obscura";
  artifacts?: string;
  tests?: string;
};

export type ConfigSource = "cli" | "workspace" | "default";

export type ResolvedConfig = {
  url: string;
  browser: "obscura";
  artifacts: string;
  tests: string;
  configPath?: string;
};

const DEFAULTS: ResolvedConfig = {
  url: "http://127.0.0.1:3000",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};

async function loadConfigFile(workspaceDir: string): Promise<WorkspaceConfig | null> {
  const possiblePaths = [
    path.join(workspaceDir, "ai-playwright.config.ts"),
    path.join(workspaceDir, "ai-playwright.config.js"),
    path.join(workspaceDir, "ai-playwright.config.json"),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      if (configPath.endsWith(".json")) {
        const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        return { ...content, configPath };
      } else if (configPath.endsWith(".ts")) {
        // For TS files, we'd need tsx to load them
        // For now, return a marker that this file exists
        const content = fs.readFileSync(configPath, "utf-8");
        // Try to extract config object by parsing
        try {
          const match = content.match(/export\s+default\s+({[\s\S]*?});/);
          if (match) {
            // Very basic parsing - only works for simple object literals
            const configStr = match[1]
              .replace(/\/\/.*/g, "") // Remove comments
              .replace(/,\s*}/g, "}"); // Remove trailing commas

            // Safe evaluation for simple object literals
            // eslint-disable-next-line no-eval
            const config = Function('"use strict"; return (' + configStr + ")")();
            return { ...config, configPath };
          }
        } catch {
          // Fall through to default
        }
      } else if (configPath.endsWith(".js")) {
        // Use dynamic import
        try {
          const module = await import(configPath);
          return { ...module.default, configPath };
        } catch {
          // Fall through to default
        }
      }
    }
  }

  return null;
}

export async function resolveConfig(
  workspaceDir: string,
  overrides?: Partial<ResolvedConfig>
): Promise<ResolvedConfig> {
  const fileConfig = await loadConfigFile(workspaceDir);
  const config: ResolvedConfig = {
    ...DEFAULTS,
    ...fileConfig,
    ...overrides,
  };

  // Resolve relative paths from workspace dir
  if (!path.isAbsolute(config.artifacts)) {
    config.artifacts = path.resolve(workspaceDir, config.artifacts);
  }
  if (!path.isAbsolute(config.tests)) {
    config.tests = path.resolve(workspaceDir, config.tests);
  }

  return config;
}

export function createDefaultConfig(workspaceDir: string): string {
  return `export default {
  url: "http://127.0.0.1:3000",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};
`;
}
