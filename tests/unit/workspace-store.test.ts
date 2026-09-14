import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeWorkspaceStore,
  listSecretProfiles,
  revealSecretProfile,
  saveSecretProfile,
  storeRunArtifacts,
  acquireRunArtifact,
  listRunArtifacts,
} from "../../packages/workspace/workspace-store.js";

const roots: string[] = [];

describe("local FeltDB secrets vault", () => {
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await closeWorkspaceStore(path.join(root, "artifacts"));
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("stores encrypted credentials and only lists safe metadata", async () => {
    const root = path.resolve(`.vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots.push(root);
    const artifacts = path.join(root, "artifacts");
    const saved = await saveSecretProfile(artifacts, {
      name: "Staging admin",
      kind: "credentials",
      values: { username: "admin@example.test", password: "super-secret-password" },
    });

    expect(saved).toMatchObject({ name: "Staging admin", kind: "credentials", fields: ["username", "password"] });
    expect(JSON.stringify(await listSecretProfiles(artifacts))).not.toContain("super-secret-password");
    expect((await revealSecretProfile(artifacts, saved.id))?.values).toEqual({
      username: "admin@example.test",
      password: "super-secret-password",
    });
    await closeWorkspaceStore(artifacts);
    const databaseFiles = await fs.readdir(path.join(root, ".runora", "feltdb"));
    const storedBytes = (await Promise.all(databaseFiles.map((file) => fs.readFile(path.join(root, ".runora", "feltdb", file))))).map((bytes) => bytes.toString("utf8")).join("");
    expect(storedBytes).not.toContain("admin@example.test");
    expect(storedBytes).not.toContain("super-secret-password");
  });

  it("stores LLM API keys in the same encrypted vault", async () => {
    const root = path.resolve(`.vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots.push(root);
    const artifacts = path.join(root, "artifacts");
    const saved = await saveSecretProfile(artifacts, {
      name: "OpenAI team key",
      kind: "openai",
      values: { apiKey: "sk-example-secret" },
    });
    const summaries = await listSecretProfiles(artifacts);
    expect(summaries).toEqual([expect.objectContaining({ id: saved.id, kind: "openai", fields: ["apiKey"] })]);
    expect((await revealSecretProfile(artifacts, saved.id))?.values.apiKey).toBe("sk-example-secret");
  });

  it("keeps content-addressed evidence available after its materialized file is removed", async () => {
    const root = path.resolve(`.vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots.push(root);
    const artifacts = path.join(root, "artifacts");
    const evidence = path.join(artifacts, "run-1", "task-001");
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, "trace.json"), '{"status":"passed"}');
    await storeRunArtifacts(artifacts, "run-1", evidence);
    await fs.rm(evidence, { recursive: true, force: true });

    expect(await listRunArtifacts(artifacts, "run-1")).toEqual([
      expect.objectContaining({ relativePath: "trace.json", contentType: "application/json" }),
    ]);
    const recovered = await acquireRunArtifact(artifacts, "run-1", "trace.json");
    expect(new TextDecoder().decode(recovered?.bytes)).toBe('{"status":"passed"}');
  });
});
