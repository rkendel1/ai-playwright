import fs from "node:fs";
import path from "node:path";
import type { TestDefinition } from "./test-model.js";
import { parseExportDefaultObject } from "./simple-object.js";

/**
 * Simple test discovery:
 * - Look for .test.ts or .test.js files in tests directory
 * - Each file is a test
 * - File name becomes test ID
 */

export async function discoverTests(testsDir: string): Promise<TestDefinition[]> {
  if (!fs.existsSync(testsDir)) {
    return [];
  }

  const tests: TestDefinition[] = [];

  try {
    const files = fs.readdirSync(testsDir);

    for (const file of files) {
      const filePath = path.join(testsDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && (file.endsWith(".test.ts") || file.endsWith(".test.js"))) {
        // File name is the test ID (without extension)
        const id = file.replace(/\.test\.(ts|js)$/, "");

        // Read file to extract test definition
        const content = fs.readFileSync(filePath, "utf-8");

        // Simple pattern: look for export default with name and task
        // Example: export default { name: "checkout", task: "test checkout" };
        try {
          const match = content.match(/export\s+default\s+({[\s\S]*?});/);
          if (match) {
            const testDef = parseExportDefaultObject(content);
            if (!testDef) continue;

            tests.push({
              id,
              name: typeof testDef.name === "string" ? testDef.name : id,
              task: typeof testDef.task === "string" ? testDef.task : "",
              url: typeof testDef.url === "string" ? testDef.url : undefined,
            });
          }
        } catch {
          // Skip malformed tests
        }
      }
    }
  } catch {
    // Return empty list if directory read fails
  }

  return tests.sort((a, b) => a.name.localeCompare(b.name));
}

export function createTestFile(testsDir: string, name: string, task: string): void {
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  const id = name.toLowerCase().replace(/\s+/g, "-");
  const filePath = path.join(testsDir, `${id}.test.ts`);

  const content = `// Test: ${name}
export default {
  name: "${name}",
  task: "${task}",
};
`;

  fs.writeFileSync(filePath, content, "utf-8");
}
