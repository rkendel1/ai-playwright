import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startFixtureServer } from "./fixture-app.js";
import type http from "node:http";

describe("CLI Integration", () => {
  let server: http.Server;
  const PORT = 9999;
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const RESULTS_DIR = path.join(process.cwd(), ".runora-results-test");

  beforeAll(async () => {
    // Clean up results directory
    if (fs.existsSync(RESULTS_DIR)) {
      fs.rmSync(RESULTS_DIR, { recursive: true });
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    // Start fixture server
    server = await startFixtureServer(PORT);
  });

  afterAll(async () => {
    // Stop server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    // Clean up results directory
    if (fs.existsSync(RESULTS_DIR)) {
      fs.rmSync(RESULTS_DIR, { recursive: true });
    }
  });

  it("should execute checkout task end-to-end", async () => {
    return new Promise<void>((resolve, reject) => {
      const child = spawn("tsx", [
        "packages/cli/index.ts",
        "--url",
        BASE_URL,
        "--planner",
        "deterministic",
        "--artifacts",
        RESULTS_DIR,
        "test checkout",
      ]);

      let output = "";
      let error = "";

      child.stdout?.on("data", (data) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data) => {
        error += data.toString();
      });

      child.on("close", (code) => {
        try {
          // Check exit code
          expect(code).toBe(0);

          // Check output contains expected markers
          expect(output).toContain("Runora");
          expect(output).toContain(BASE_URL);
          expect(output).toContain("test checkout");
          expect(output.toUpperCase()).toContain("PASSED");

          // Check that evidence file was created
          const files = fs.readdirSync(RESULTS_DIR);
          expect(files.length).toBeGreaterThan(0);

          // Parse the result JSON
          const resultFile = files.find((f) => f.startsWith("result-"));
          expect(resultFile).toBeDefined();

          if (resultFile) {
            const resultPath = path.join(RESULTS_DIR, resultFile);
            const resultJson = JSON.parse(fs.readFileSync(resultPath, "utf-8"));

            // Verify result structure
            expect(resultJson).toHaveProperty("status");
            expect(resultJson.status).toBe("passed");
            expect(resultJson).toHaveProperty("steps");
            expect(resultJson.steps.length).toBeGreaterThan(0);
            expect(resultJson).toHaveProperty("evidence");
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, 60000);
});
