#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { aiPlaywright } from "../core/index.js";

export function parseArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "run") {
    throw new Error("Usage: aipw run [--url <url>] \"task instruction\"");
  }

  let url: string | undefined;
  const instructionParts: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--url") {
      url = rest[i + 1];
      i += 1;
      continue;
    }
    instructionParts.push(token);
  }

  const instruction = instructionParts.join(" ").trim();
  if (!instruction) {
    throw new Error("Please provide a task instruction.");
  }

  return { url, instruction };
}

async function main() {
  const startedAt = Date.now();
  const { url, instruction } = parseArgs(process.argv.slice(2));

  console.log("AI Playwright");
  console.log("Starting Obscura...");
  console.log("Loading local model...");

  const browser = await aiPlaywright({
    browser: "obscura",
    model: "webllm",
    url,
  });

  try {
    const result = await browser.task(instruction);
    console.log(result.status.toUpperCase());
    console.log(`Steps: ${result.steps.length}`);
    console.log(`Duration: ${(Date.now() - startedAt) / 1000}s`);
    console.log("Trace:");
    console.log(`${result.artifactsPath}/trace.json`);
    if (result.error) {
      console.log(`Reason: ${result.error.reason}`);
    }
    process.exitCode = result.status === "passed" ? 0 : 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
