import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createTest,
  updateTest,
  deleteTest,
  getTest,
  resolveConfig,
  discoverTests,
  runTests,
  listRuns,
  getLatestRun,
} from "../../packages/workspace/index.js";

describe("Test Management - PR #11", () => {
  let testsDir: string;

  beforeEach(async () => {
    // Create temporary tests directory
    testsDir = path.resolve(`./.test-mgmt-${Date.now()}`);
    await fs.mkdir(testsDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    if (testsDir && (await fs.stat(testsDir).catch(() => null))) {
      await fs.rm(testsDir, { recursive: true, force: true });
    }
  });

  describe("Create test", () => {
    it("creates a new test file with correct format", async () => {
      const testDef = createTest(testsDir, {
        name: "Checkout Flow",
        task: "Complete a checkout",
        url: "http://example.com",
      });

      expect(testDef.id).toBe("checkout-flow");
      expect(testDef.name).toBe("Checkout Flow");
      expect(testDef.task).toBe("Complete a checkout");
      expect(testDef.url).toBe("http://example.com");

      // Verify file was created
      const filePath = path.join(testsDir, "checkout-flow.test.ts");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toContain('"checkout-flow"');
      expect(content).toContain('"Checkout Flow"');
      expect(content).toContain('"Complete a checkout"');
    });

    it("creates test without optional URL", async () => {
      const testDef = createTest(testsDir, {
        name: "Simple Test",
        task: "Do something",
      });

      expect(testDef.id).toBe("simple-test");
      expect(testDef.url).toBeUndefined();

      const filePath = path.join(testsDir, "simple-test.test.ts");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).not.toContain("url:");
    });

    it("generates ID from name by lowercasing and replacing spaces", async () => {
      const testDef = createTest(testsDir, {
        name: "Test Payment Validation",
        task: "Validate payment",
      });

      expect(testDef.id).toBe("test-payment-validation");
    });

    it("throws error if test already exists", async () => {
      createTest(testsDir, {
        name: "Existing Test",
        task: "Task",
      });

      expect(() =>
        createTest(testsDir, {
          name: "Existing Test",
          task: "Different task",
        })
      ).toThrow("already exists");
    });

    it("creates test file discoverable by discoverTests", async () => {
      createTest(testsDir, {
        name: "Discovery Test",
        task: "Test discovery",
      });

      const discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toBe("Discovery Test");
    });
  });

  describe("Update test", () => {
    it("updates test name", async () => {
      createTest(testsDir, {
        name: "Original Name",
        task: "Task",
      });

      const updated = updateTest(testsDir, "original-name", {
        name: "Updated Name",
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.id).toBe("original-name");

      // Verify file was updated
      const content = await fs.readFile(
        path.join(testsDir, "original-name.test.ts"),
        "utf-8"
      );
      expect(content).toContain('"Updated Name"');
    });

    it("updates test task", async () => {
      createTest(testsDir, {
        name: "Test",
        task: "Original task",
      });

      const updated = updateTest(testsDir, "test", {
        task: "Updated task",
      });

      expect(updated.task).toBe("Updated task");
    });

    it("updates test URL", async () => {
      createTest(testsDir, {
        name: "Test",
        task: "Task",
        url: "http://old.com",
      });

      const updated = updateTest(testsDir, "test", {
        url: "http://new.com",
      });

      expect(updated.url).toBe("http://new.com");
    });

    it("updates multiple fields at once", async () => {
      createTest(testsDir, {
        name: "Original",
        task: "Original task",
        url: "http://old.com",
      });

      const updated = updateTest(testsDir, "original", {
        name: "New Name",
        task: "New task",
        url: "http://new.com",
      });

      expect(updated.name).toBe("New Name");
      expect(updated.task).toBe("New task");
      expect(updated.url).toBe("http://new.com");
    });

    it("throws error if test does not exist", async () => {
      expect(() =>
        updateTest(testsDir, "nonexistent", { name: "New Name" })
      ).toThrow("not found");
    });
  });

  describe("Delete test", () => {
    it("deletes test file", async () => {
      createTest(testsDir, {
        name: "To Delete",
        task: "Task",
      });

      deleteTest(testsDir, "to-delete");

      const filePath = path.join(testsDir, "to-delete.test.ts");
      expect(await fs.stat(filePath).catch(() => null)).toBeNull();
    });

    it("test disappears from discovery after deletion", async () => {
      createTest(testsDir, {
        name: "Will Delete",
        task: "Task",
      });

      let discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);

      deleteTest(testsDir, "will-delete");

      discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(0);
    });

    it("throws error if test does not exist", async () => {
      expect(() => deleteTest(testsDir, "nonexistent")).toThrow("not found");
    });
  });

  describe("Get test", () => {
    it("retrieves test definition", async () => {
      createTest(testsDir, {
        name: "Retrieve Me",
        task: "Task",
        url: "http://example.com",
      });

      const test = getTest(testsDir, "retrieve-me");
      expect(test).toEqual({
        id: "retrieve-me",
        name: "Retrieve Me",
        task: "Task",
        url: "http://example.com",
      });
    });

    it("returns null for nonexistent test", async () => {
      const test = getTest(testsDir, "nonexistent");
      expect(test).toBeNull();
    });
  });

  describe("Run history survives deletion", () => {
    it("deleting test does not delete run records", async () => {
      const workspaceDir = path.resolve(`./.test-workspace-${Date.now()}`);
      const artifactsDir = path.join(workspaceDir, "artifacts");

      try {
        await fs.mkdir(artifactsDir, { recursive: true });
        const testDef = createTest(testsDir, {
          name: "Deletable Test",
          task: "Task",
        });

        // Simulate creating some run records
        const runPath = path.join(
          artifactsDir,
          "run-123-abc.json"
        );
        await fs.mkdir(path.dirname(runPath), { recursive: true });
        await fs.writeFile(
          runPath,
          JSON.stringify({
            testId: testDef.id,
            testName: testDef.name,
            url: "http://example.com",
            browser: "obscura",
            startedAt: Date.now(),
            finishedAt: Date.now() + 1000,
            status: "passed",
            durationMs: 1000,
          }),
          "utf-8"
        );

        // Delete the test
        deleteTest(testsDir, testDef.id);

        // Verify run record still exists
        const runContent = await fs.readFile(runPath, "utf-8");
        const run = JSON.parse(runContent);
        expect(run.testId).toBe(testDef.id);
      } finally {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      }
    });
  });

  describe("Test file format contract", () => {
    it("generated files follow stable export default format", async () => {
      createTest(testsDir, {
        name: "Format Test",
        task: "Check format",
        url: "http://example.com",
      });

      const content = await fs.readFile(
        path.join(testsDir, "format-test.test.ts"),
        "utf-8"
      );

      // Should have export default
      expect(content).toMatch(/export\s+default\s+{/);

      // Should have all fields
      expect(content).toMatch(/id:\s*"format-test"/);
      expect(content).toMatch(/name:\s*"Format Test"/);
      expect(content).toMatch(/task:\s*"Check format"/);
      expect(content).toMatch(/url:\s*"http:\/\/example\.com"/);
    });

    it("format is parseable by existing discovery", async () => {
      createTest(testsDir, {
        name: "Parseable Test",
        task: "Test parsing",
        url: "http://example.com",
      });

      const discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0]).toMatchObject({
        id: "parseable-test",
        name: "Parseable Test",
        task: "Test parsing",
        url: "http://example.com",
      });
    });

    it("handles special characters in strings", async () => {
      createTest(testsDir, {
        name: 'Test with "quotes"',
        task: 'Task with "quotes" and \\backslashes\\',
      });

      const discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toContain('Test with "quotes"');
    });
  });

  describe("Integration: create, edit, delete workflow", () => {
    it("complete workflow: create -> discover -> edit -> discover -> delete -> discover", async () => {
      // Create
      const created = createTest(testsDir, {
        name: "Workflow Test",
        task: "Initial task",
        url: "http://v1.com",
      });
      expect(created.id).toBe("workflow-test");

      // Discover
      let discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toBe("Workflow Test");

      // Edit
      const updated = updateTest(testsDir, "workflow-test", {
        name: "Updated Workflow",
        task: "Updated task",
        url: "http://v2.com",
      });
      expect(updated.name).toBe("Updated Workflow");

      // Discover after edit
      discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toBe("Updated Workflow");

      // Delete
      deleteTest(testsDir, "workflow-test");

      // Discover after delete
      discovered = await discoverTests(testsDir);
      expect(discovered).toHaveLength(0);
    });
  });
});
