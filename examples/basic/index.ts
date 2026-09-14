import { aiPlaywright } from "../../packages/core/index.js";

async function demo() {
  const browser = await aiPlaywright({
    browser: "obscura",
    model: "webllm",
    headless: false,
    url: "http://localhost:3000",
  });

  const result = await browser.task(`
    Open the demo application.
    Create a project named "Demo".
    Verify that "Demo" appears in the project list.
  `);

  console.log(result);
  await browser.close();
}

void demo();
