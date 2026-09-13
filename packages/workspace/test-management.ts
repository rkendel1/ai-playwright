import fs from "node:fs";
import path from "node:path";
import type { TestDefinition } from "./test-model.js";
import { parseExportDefaultObject } from "./simple-object.js";

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
  const current = parseExportDefaultObject(content);
  if (!current) {
    throw new Error(`Invalid test file format for "${testId}"`);
  }

  // Merge updates
  const updated = {
    id: typeof current.id === "string" ? current.id : testId,
    name: updates.name ?? (typeof current.name === "string" ? current.name : testId),
    task: updates.task ?? (typeof current.task === "string" ? current.task : ""),
    url: updates.url ?? (typeof current.url === "string" ? current.url : undefined),
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
  try {
    const def = parseExportDefaultObject(content);
    if (!def) return null;
    return {
      id: typeof def.id === "string" ? def.id : testId,
      name: typeof def.name === "string" ? def.name : testId,
      task: typeof def.task === "string" ? def.task : "",
      url: typeof def.url === "string" ? def.url : undefined,
    };
  } catch {
    return null;
  }
}
