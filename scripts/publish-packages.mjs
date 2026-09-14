#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const otp = process.argv.find((argument) => argument.startsWith("--otp="))?.slice(6)
  || process.env.npm_config_otp;
const packageDirs = [root, path.join(root, "packages", "create-runora")];

function run(args, cwd, capture = false) {
  return spawnSync(npm, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    shell: false,
  });
}

for (const directory of packageDirs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const spec = `${manifest.name}@${manifest.version}`;
  const existing = run(["view", spec, "version"], root, true);
  if (existing.status === 0 && existing.stdout.trim() === manifest.version) {
    console.log(`✓ ${spec} is already published; skipping`);
    continue;
  }

  console.log(`Publishing ${spec}…`);
  const args = ["publish"];
  if (otp) args.push(`--otp=${otp}`);
  const published = run(args, directory);
  if (published.status !== 0) process.exit(published.status ?? 1);
}

console.log("✓ All Runora packages are published");
