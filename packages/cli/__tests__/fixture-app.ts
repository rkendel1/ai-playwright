import http from "node:http";
import { URL } from "node:url";

/**
 * Simple fixture app for CLI testing
 * Implements a minimal checkout flow
 */

const htmlPages: Record<string, string> = {
  home: `
    <!DOCTYPE html>
    <html>
      <head><title>Test App</title></head>
      <body>
        <h1>Checkout Test</h1>
        <p>Welcome to test checkout</p>
        <button name="checkout">Proceed to checkout</button>
      </body>
      <script>
        document.querySelector('button[name="checkout"]').addEventListener('click', () => {
          window.location.href = '/checkout';
        });
      </script>
    </html>
  `,
  checkout: `
    <!DOCTYPE html>
    <html>
      <head><title>Checkout</title></head>
      <body>
        <h1>Checkout Form</h1>
        <form onsubmit="return handleSubmit(event)">
          <label for="email-field">Email Address</label>
          <input type="email" name="email" id="email-field" />
          <label for="name-field">Full Name</label>
          <input type="text" name="name" id="name-field" />
          <button type="submit" name="continue">Continue to payment</button>
        </form>
      </body>
      <script>
        function handleSubmit(event) {
          event.preventDefault();
          const email = document.getElementById('email-field').value;
          const name = document.getElementById('name-field').value;
          if (email && name) {
            window.location.href = '/confirmation';
          }
          return false;
        }
      </script>
    </html>
  `,
  confirmation: `
    <!DOCTYPE html>
    <html>
      <head><title>Order Confirmed</title></head>
      <body>
        <h1>Order confirmed</h1>
        <p>Thank you for your purchase!</p>
      </body>
    </html>
  `,
};

export function createFixtureServer(): http.Server {
  return http.createServer((req, res) => {
    try {
      const parsedUrl = new URL(req.url || "/", "http://localhost");
      const pathname = parsedUrl.pathname === "/" ? "home" : parsedUrl.pathname.slice(1);

      if (pathname in htmlPages) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlPages[pathname as keyof typeof htmlPages]);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } catch (error) {
      res.writeHead(500);
      res.end("Internal server error");
    }
  });
}

export function startFixtureServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = createFixtureServer();
    server.listen(port, () => {
      resolve(server);
    });
  });
}
