import http from "node:http";
import url from "node:url";

export type CXAppOptions = {
  port?: number;
};

export async function startCXApp(options: CXAppOptions = {}) {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || "/", true);
    const pathname = parsed.pathname ?? "/";

    res.setHeader("content-type", "text/html");

    if (pathname === "/") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Checkout Demo</title>
  </head>
  <body>
    <h1>Checkout Demo</h1>
    <p>Welcome to the demo store.</p>
    <button id="checkout" type="button">Proceed to Checkout</button>
    <script>
      document.getElementById('checkout')?.addEventListener('click', () => {
        window.location.href = '/checkout';
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/checkout") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Checkout</title>
  </head>
  <body>
    <h1>Checkout</h1>
    <p>Enter your email to complete checkout.</p>
    <form id="checkout-form">
      <label for="email">Email Address</label>
      <input id="email" name="email" type="email" aria-label="Email Address" required />
      <button id="submit-payment" type="button">Submit payment</button>
    </form>
    <script>
      document.getElementById('submit-payment')?.addEventListener('click', () => {
        window.location.href = '/confirmation';
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/confirmation") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Confirmation</title>
  </head>
  <body>
    <h1>Order confirmed</h1>
    <p>Your order has been received.</p>
  </body>
</html>`);
      return;
    }

    if (pathname === "/invalid-payment") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Invalid Payment</title>
  </head>
  <body>
    <h1>Invalid Payment</h1>
    <p>This journey intentionally fails after planning the payment submission.</p>
    <button id="checkout" type="button">Proceed to Checkout</button>
    <script>
      document.getElementById('checkout')?.addEventListener('click', () => {
        window.location.href = '/invalid-payment/checkout';
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/invalid-payment/checkout") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Invalid Payment Checkout</title>
    <style>
      body {
        position: relative;
      }
      #submit-blocker {
        position: fixed;
        inset: 0;
        background: rgba(255, 255, 255, 0.01);
        z-index: 999;
      }
      #submit-blocker[hidden] {
        display: none;
      }
    </style>
  </head>
  <body>
    <h1>Checkout</h1>
    <p>Enter your email to complete checkout.</p>
    <form id="checkout-form">
      <label for="email">Email Address</label>
      <input id="email" name="email" type="email" aria-label="Email Address" required />
      <button id="submit-payment" type="button">Submit payment</button>
    </form>
    <div id="submit-blocker" hidden aria-hidden="true"></div>
    <script>
      document.getElementById('email')?.addEventListener('input', () => {
        document.getElementById('submit-blocker')?.removeAttribute('hidden');
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/home") {
      res.end(`<!doctype html>
<html>
  <head>
    <title>Home</title>
  </head>
  <body>
    <h1>Home</h1>
    <p>Success: checkout demo home page loaded.</p>
  </body>
</html>`);
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start CX demo app.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    url: baseUrl,
    routes: {
      checkout: `${baseUrl}/`,
      invalidPayment: `${baseUrl}/invalid-payment`,
      home: `${baseUrl}/home`,
    },
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}
