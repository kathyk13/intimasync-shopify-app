import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { login } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const errors = await login(request);
  return json({ errors: errors ?? {} });
}

export async function action({ request }: ActionFunctionArgs) {
  const errors = await login(request);
  return json({ errors: errors ?? {} });
}

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = actionData?.errors ?? loaderData?.errors ?? {};

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1>IntimaSync</h1>
      <Form method="post">
        <label htmlFor="shop">Shop domain</label>
        <br />
        <input
          id="shop"
          name="shop"
          type="text"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="your-shop.myshopify.com"
          style={{ width: "100%", padding: 8, margin: "8px 0" }}
        />
        {"shop" in errors && (
          <p style={{ color: "red" }}>{(errors as { shop: string }).shop}</p>
        )}
        <button type="submit" style={{ padding: "8px 16px" }}>
          Install app
        </button>
      </Form>
    </div>
  );
}
