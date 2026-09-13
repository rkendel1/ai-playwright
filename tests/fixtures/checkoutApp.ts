import http from "node:http";
import url from "node:url";

export type CheckoutAppOptions = {
  mode?: "success" | "missing-email" | "missing-checkout" | "assertion-fail";
};

export async function startCheckoutApp(options: CheckoutAppOptions = {}) {
  const mode = options.mode ?? "success";

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname;

    res.setHeader("content-type", "text/html");

    if (pathname === "/") {
      // Home page with checkout button (unless mode is missing-checkout)
      const checkoutButton =
        mode === "missing-checkout"
          ? ""
          : `<button id="checkout" type="button">Proceed to Checkout</button>`;

      res.end(`<!doctype html>
<html>
  <head>
    <title>Shop</title>
  </head>
  <body>
    <h1>Welcome to our shop</h1>
    <p>Click checkout to begin</p>
    ${checkoutButton}
    <div id="cart-items">
      <h2>Cart</h2>
      <ul>
        <li>Product A - $10</li>
      </ul>
    </div>
    <script>
      const checkoutBtn = document.getElementById('checkout');
      if (checkoutBtn) {
        checkoutBtn.addEventListener('click', () => {
          window.location.href = '/checkout';
        });
      }
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/checkout") {
      // Checkout form (conditionally includes email field)
      const emailField =
        mode === "missing-email"
          ? ""
          : `<label for="email">Email Address</label>
            <input id="email" name="email" type="email" aria-label="Email Address" required />`;

      res.end(`<!doctype html>
<html>
  <head>
    <title>Checkout</title>
  </head>
  <body>
    <h1>Checkout Form</h1>
    <form id="checkout-form">
      ${emailField}
      <label for="name">Full Name</label>
      <input id="name" name="name" type="text" aria-label="Full Name" required />
      <button id="submit" type="submit">Complete Purchase</button>
    </form>
    <script>
      document.getElementById('checkout-form').addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = '/confirmation';
      });
    </script>
  </body>
</html>`);
      return;
    }

    if (pathname === "/confirmation") {
      // Confirmation page with appropriate message based on mode
      const message =
        mode === "assertion-fail"
          ? `<h1>Thank you!</h1><p>Your order has been received. Order ID: 12345</p>` // Missing "Order confirmed"
          : `<h1>Order confirmed</h1><p>Your order has been received. Order ID: 12345</p>`;

      res.end(`<!doctype html>
<html>
  <head>
    <title>Confirmation</title>
  </head>
  <body>
    ${message}
  </body>
</html>`);
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start checkout app server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}
