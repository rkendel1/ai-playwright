import fs from "node:fs";
import path from "node:path";
import type { TestDefinition } from "./test-model.js";

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
            // Parse definition, handling URLs with //
            let configStr = match[1];

            // Remove line comments but preserve URLs with //
            configStr = configStr
              .split("\n")
              .map((line) => {
                const commentIndex = line.lastIndexOf("//");
                if (commentIndex === -1) return line;
                // Check if // is inside a string
                const beforeComment = line.substring(0, commentIndex);
                const stringCount = (beforeComment.match(/"/g) || []).length;
                // If odd number of quotes, the // is inside a string
                if (stringCount % 2 === 1) return line;
                return beforeComment;
              })
              .join("\n")
              .replace(/,\s*}/g, "}"); // Remove trailing commas

            // Safe evaluation for simple object literals
            // eslint-disable-next-line no-eval
            const testDef = Function('"use strict"; return (' + configStr + ")")();

            tests.push({
              id,
              name: testDef.name || id,
              task: testDef.task,
              url: testDef.url,
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
