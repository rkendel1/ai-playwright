import http from "node:http";

export type DemoAppOptions = {
  buttonLabel?: string;
  includeCreateButton?: boolean;
};

export async function startDemoApp(options: DemoAppOptions = {}) {
  const buttonLabel = options.buttonLabel ?? "New Project";
  const includeCreateButton = options.includeCreateButton ?? true;

  const server = http.createServer((req, res) => {
    if (req.url !== "/") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const buttonHtml = includeCreateButton ? `<button id=\"new-project\" type=\"button\">${buttonLabel}</button>` : "";

    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html>
<html>
  <head>
    <title>Projects</title>
  </head>
  <body>
    <h1>Projects</h1>
    <ul id="project-list">
      <li>Alpha</li>
      <li>Beta</li>
    </ul>
    ${buttonHtml}
    <form id="create-form" hidden>
      <label for="project-name">Project Name</label>
      <input id="project-name" name="project-name" aria-label="Project Name" />
      <button id="create-project" type="submit">Create</button>
    </form>
    <script>
      const newProjectButton = document.getElementById('new-project');
      const form = document.getElementById('create-form');
      const list = document.getElementById('project-list');

      if (newProjectButton) {
        newProjectButton.addEventListener('click', () => {
          form.hidden = false;
          document.getElementById('project-name').focus();
        });
      }

      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('project-name');
        const li = document.createElement('li');
        li.textContent = input.value;
        list.appendChild(li);
        form.hidden = true;
      });
    </script>
  </body>
</html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start demo app server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
