import fs from "node:fs";
import path from "node:path";
import type { TestDefinition } from "./test-model.js";

/**
 * Test management: create, update, delete test files
 * Filesystem is authoritative; all operations persist to .test.ts files
 */

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function createTest(
  testsDir: string,
  testDef: Omit<TestDefinition, "id">
): TestDefinition {
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  // Generate ID from name
  const id = testDef.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const filePath = path.join(testsDir, `${id}.test.ts`);

  // Check if test already exists
  if (fs.existsSync(filePath)) {
    throw new Error(`Test "${id}" already exists`);
  }

  // Create test file with stable format
  const content = `export default {
  id: "${id}",
  name: "${escapeString(testDef.name)}",
  task: "${escapeString(testDef.task)}",${
    testDef.url ? `\n  url: "${escapeString(testDef.url)}",` : ""
  }
};
`;

  fs.writeFileSync(filePath, content, "utf-8");

  return {
    id,
    name: testDef.name,
    task: testDef.task,
    url: testDef.url,
  };
}

export function updateTest(
  testsDir: string,
  testId: string,
  updates: Partial<Omit<TestDefinition, "id">>
): TestDefinition {
  const filePath = path.join(testsDir, `${testId}.test.ts`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Test "${testId}" not found`);
  }

  // Read current definition
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/export\s+default\s+({[\s\S]*?});/);
  if (!match) {
    throw new Error(`Invalid test file format for "${testId}"`);
  }

  // Parse current definition
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

  // eslint-disable-next-line no-eval
  const current = Function('"use strict"; return (' + configStr + ")")();

  // Merge updates
  const updated = {
    id: current.id || testId,
    name: updates.name ?? current.name,
    task: updates.task ?? current.task,
    url: updates.url ?? current.url,
  };

  // Write updated file
  const newContent = `export default {
  id: "${updated.id}",
  name: "${updated.name.replace(/"/g, '\\"')}",
  task: "${updated.task.replace(/"/g, '\\"')}",${
    updated.url ? `\n  url: "${updated.url.replace(/"/g, '\\"')}",` : ""
  }
};
`;

  fs.writeFileSync(filePath, newContent, "utf-8");

  return updated;
}

export function deleteTest(testsDir: string, testId: string): void {
  const filePath = path.join(testsDir, `${testId}.test.ts`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Test "${testId}" not found`);
  }

  fs.unlinkSync(filePath);
}

export function getTest(
  testsDir: string,
  testId: string
): TestDefinition | null {
  const filePath = path.join(testsDir, `${testId}.test.ts`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(/export\s+default\s+({[\s\S]*?});/);

  if (!match) {
    return null;
  }

  // Parse current definition, handling URLs with //
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
    .replace(/,\s*}/g, "}");

  try {
    // eslint-disable-next-line no-eval
    const def = Function('"use strict"; return (' + configStr + ")")();
    return {
      id: def.id || testId,
      name: def.name,
      task: def.task,
      url: def.url,
    };
  } catch {
    return null;
  }
}
