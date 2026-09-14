import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createFeltDB, type StateFirstDB } from "@feltdb/core";

export type SecretKind = "credentials" | "openai" | "anthropic";

export type SecretProfileSummary = {
  id: string;
  name: string;
  kind: SecretKind;
  fields: string[];
  createdAt: number;
  updatedAt: number;
};

type CipherValue = { iv: string; tag: string; ciphertext: string };
type StoredSecretProfile = Omit<SecretProfileSummary, "fields"> & {
  encrypted: Record<string, CipherValue>;
};
export type ArtifactRecord = {
  id: string;
  runId: string;
  relativePath: string;
  contentHash: string;
  contentBase64: string;
  size: number;
  contentType: string;
  createdAt: number;
};

const stores = new Map<string, StateFirstDB>();
const pending = new Map<string, Promise<void>>();

function stateRoot(artifactsDir: string): string {
  return path.join(path.dirname(path.resolve(artifactsDir)), ".runora");
}

function cleanRecord<T>(record: T): T {
  if (!record || typeof record !== "object") return record;
  const { __version: _version, ...clean } = record as Record<string, unknown>;
  return clean as T;
}

export function workspaceDatabase(artifactsDir: string): StateFirstDB {
  const root = stateRoot(artifactsDir);
  let db = stores.get(root);
  if (!db) {
    fs.mkdirSync(root, { recursive: true });
    db = createFeltDB({ namespace: "runora", path: path.join(root, "feltdb") });
    stores.set(root, db);
  }
  return db;
}

async function putRecord<T extends { id: string }>(artifactsDir: string, collection: string, record: T): Promise<void> {
  const target = workspaceDatabase(artifactsDir).collection<T>(collection);
  if (await target.exists(record.id)) await target.update(record.id, record);
  else await target.insert(record, record.id);
}

export function queueRecord<T extends { id: string }>(artifactsDir: string, collection: string, record: T): void {
  const root = stateRoot(artifactsDir);
  const next = (pending.get(root) ?? Promise.resolve())
    .then(() => putRecord(artifactsDir, collection, record))
    .catch((error) => console.warn(`Runora FeltDB write failed: ${error instanceof Error ? error.message : String(error)}`));
  pending.set(root, next);
}

export async function flushWorkspaceStore(artifactsDir: string): Promise<void> {
  await pending.get(stateRoot(artifactsDir));
}

export function subscribeWorkspaceChanges(
  artifactsDir: string,
  listener: (collection: "runs" | "suite_runs" | "secrets") => void,
): () => void {
  const db = workspaceDatabase(artifactsDir);
  const collections = (["runs", "suite_runs", "secrets"] as const).map((name) => {
    const collection = db.collection<Record<string, unknown>>(name);
    const unsubscribe = collection.subscribe(() => listener(name));
    return { collection, unsubscribe };
  });

  return () => {
    for (const { collection, unsubscribe } of collections) {
      unsubscribe();
      collection.close();
    }
  };
}

async function migrateJsonRecords(artifactsDir: string, prefix: string, collection: string): Promise<void> {
  if (!fs.existsSync(artifactsDir)) return;
  const target = workspaceDatabase(artifactsDir).collection<Record<string, unknown>>(collection);
  for (const file of fs.readdirSync(artifactsDir).filter((name) => name.startsWith(prefix) && name.endsWith(".json"))) {
    const id = file.slice(0, -5);
    if (await target.exists(id)) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(artifactsDir, file), "utf8"));
    await target.insert(parsed, id);
  }
}

export async function listStoredRecords<T>(artifactsDir: string, collection: "runs" | "suite_runs"): Promise<T[]> {
  await flushWorkspaceStore(artifactsDir);
  await migrateJsonRecords(artifactsDir, collection === "runs" ? "run-" : "suite-", collection);
  return (await workspaceDatabase(artifactsDir).collection<T>(collection).all())
    .map(cleanRecord)
    .sort((left, right) => Number((right as Record<string, unknown>).startedAt ?? 0) - Number((left as Record<string, unknown>).startedAt ?? 0));
}

export async function getStoredRecord<T>(artifactsDir: string, collection: "runs" | "suite_runs", id: string): Promise<T | null> {
  await flushWorkspaceStore(artifactsDir);
  const record = await workspaceDatabase(artifactsDir).collection<T>(collection).get(id);
  return record ? cleanRecord(record) : null;
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".json") return "application/json";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function filesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

export async function storeRunArtifacts(artifactsDir: string, runId: string, evidenceDir: string): Promise<void> {
  for (const file of filesUnder(evidenceDir)) {
    const bytes = fs.readFileSync(file);
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const relativePath = path.relative(evidenceDir, file).replaceAll(path.sep, "/");
    await putRecord<ArtifactRecord>(artifactsDir, "artifacts", {
      id: `${runId}:${relativePath}`,
      runId,
      relativePath,
      contentHash,
      contentBase64: bytes.toString("base64"),
      size: bytes.length,
      contentType: contentType(file),
      createdAt: Date.now(),
    });
  }
}

export async function acquireRunArtifact(artifactsDir: string, runId: string, relativePath: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const record = await workspaceDatabase(artifactsDir).collection<ArtifactRecord>("artifacts").get(`${runId}:${relativePath}`);
  if (!record) return null;
  const bytes = Buffer.from(record.contentBase64, "base64");
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== record.contentHash) throw new Error(`Stored artifact '${relativePath}' failed integrity verification`);
  return { bytes, contentType: record.contentType };
}

export async function listRunArtifacts(artifactsDir: string, runId: string): Promise<ArtifactRecord[]> {
  return (await workspaceDatabase(artifactsDir).collection<ArtifactRecord>("artifacts").find({ runId } as Partial<ArtifactRecord>))
    .map(cleanRecord)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function vaultKey(artifactsDir: string): Buffer {
  const environment = process.env.RUNORA_VAULT_KEY;
  if (environment) {
    const key = Buffer.from(environment, "base64");
    if (key.length !== 32) throw new Error("RUNORA_VAULT_KEY must be a base64-encoded 32-byte key");
    return key;
  }
  const keyPath = path.join(stateRoot(artifactsDir), "vault.key");
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
  }
  if (process.platform !== "win32") fs.chmodSync(keyPath, 0o600);
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Runora vault key is invalid");
  return key;
}

function encrypt(value: string, key: Buffer): CipherValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decrypt(value: CipherValue, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export async function saveSecretProfile(
  artifactsDir: string,
  input: { id?: string; name: string; kind: SecretKind; values: Record<string, string> },
): Promise<SecretProfileSummary> {
  const id = input.id || `secret-${crypto.randomUUID()}`;
  const collection = workspaceDatabase(artifactsDir).collection<StoredSecretProfile>("secrets");
  const previous = await collection.get(id);
  const values = Object.fromEntries(Object.entries(input.values).filter(([, value]) => typeof value === "string" && value.length > 0));
  if (!input.name.trim()) throw new Error("Secret profile name is required");
  if (!Object.keys(values).length && !previous) throw new Error("At least one secret value is required");
  const encrypted = { ...(previous?.encrypted ?? {}) };
  const key = vaultKey(artifactsDir);
  for (const [field, value] of Object.entries(values)) encrypted[field] = encrypt(value, key);
  const record: StoredSecretProfile = {
    id,
    name: input.name.trim(),
    kind: input.kind,
    encrypted,
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (previous) await collection.update(id, record);
  else await collection.insert(record, id);
  return { ...record, fields: Object.keys(encrypted), encrypted: undefined } as unknown as SecretProfileSummary;
}

export async function listSecretProfiles(artifactsDir: string): Promise<SecretProfileSummary[]> {
  const records = await workspaceDatabase(artifactsDir).collection<StoredSecretProfile>("secrets").all();
  return records.map((record) => ({ id: record.id, name: record.name, kind: record.kind, fields: Object.keys(record.encrypted), createdAt: record.createdAt, updatedAt: record.updatedAt }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function revealSecretProfile(artifactsDir: string, id: string): Promise<{ summary: SecretProfileSummary; values: Record<string, string> } | null> {
  const record = await workspaceDatabase(artifactsDir).collection<StoredSecretProfile>("secrets").get(id);
  if (!record) return null;
  const key = vaultKey(artifactsDir);
  return {
    summary: { id: record.id, name: record.name, kind: record.kind, fields: Object.keys(record.encrypted), createdAt: record.createdAt, updatedAt: record.updatedAt },
    values: Object.fromEntries(Object.entries(record.encrypted).map(([field, value]) => [field, decrypt(value, key)])),
  };
}

export async function deleteSecretProfile(artifactsDir: string, id: string): Promise<void> {
  await workspaceDatabase(artifactsDir).collection<StoredSecretProfile>("secrets").delete(id);
}

export async function closeWorkspaceStore(artifactsDir: string): Promise<void> {
  const root = stateRoot(artifactsDir);
  await flushWorkspaceStore(artifactsDir);
  const db = stores.get(root);
  if (db) await db.close();
  stores.delete(root);
  pending.delete(root);
}
