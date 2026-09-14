#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const install = !args.includes("--no-install");
const filteredArgs = args.filter((arg) => arg !== "--no-install");
const projectName = filteredArgs[0] || "my-runora-project";
const projectDir = path.resolve(process.cwd(), projectName);
const runoraPackageSpec = process.env.RUNORA_PACKAGE_SPEC || "^1.0.16";

if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0) {
  console.error(`Directory already exists and is not empty: ${projectDir}`);
  process.exit(1);
}

fs.mkdirSync(path.join(projectDir, "tests"), { recursive: true });

fs.writeFileSync(
  path.join(projectDir, "package.json"),
  JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        test: "runora test",
        ui: "runora ui",
      },
      dependencies: {
        runora: runoraPackageSpec,
      },
    },
    null,
    2
  ) + "\n",
  "utf-8"
);

fs.writeFileSync(
  path.join(projectDir, "runora.config.ts"),
  `export default {
  url: "http://localhost:3000",
  planner: "webllm",
  headless: true,
  browser: "obscura",
  artifacts: "./artifacts",
  tests: "./tests",
};
`,
  "utf-8"
);

fs.writeFileSync(
  path.join(projectDir, "tests", "example.test.ts"),
  `export default {
  id: "example",
  name: "Example",
  task: "Open the application and verify it loads",
};
`,
  "utf-8"
);

fs.writeFileSync(
  path.join(projectDir, "README.md"),
  `# ${projectName}

This is a Runora project.

## Run

\`\`\`bash
npx runora test
npx runora ui
\`\`\`
`,
  "utf-8"
);

if (install) {
  const result = spawnSync("npm", ["install"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`✓ Runora project created at ${projectDir}`);
console.log(`  cd ${projectName}`);
console.log("  npx runora init");
