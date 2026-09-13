import fs from "node:fs";
import path from "node:path";
import { parseExportDefaultObject } from "./simple-object.js";

export type PlannerMode = "webllm" | "deterministic" | "mock";
export type ModelConfig = "webllm" | { provider: "webllm"; model: string };

export type WorkspaceConfig = {
  url?: string;
  browser?: "obscura";
  artifacts?: string;
  tests?: string;
  planner?: PlannerMode;
  model?: ModelConfig;
};

export type ConfigSource = "cli" | "workspace" | "default";

export type ResolvedConfig = {
  url: string;
  browser: "obscura";
  artifacts: string;
  tests: string;
  planner: PlannerMode;
  model?: ModelConfig;
  configPath?: string;
};

const DEFAULTS: ResolvedConfig = {
  url: "http://127.0.0.1:3000",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
  planner: "deterministic",
};

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

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
        const content = fs.readFileSync(configPath, "utf-8");
        try {
          const config = parseExportDefaultObject(content);
          if (config) return { ...config, configPath } as WorkspaceConfig;
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
    ...withoutUndefined(fileConfig ?? {}),
    ...withoutUndefined(overrides ?? {}),
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
  planner: "deterministic",
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};
`;
}
