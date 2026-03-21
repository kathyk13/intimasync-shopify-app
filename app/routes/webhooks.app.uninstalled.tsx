import { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  if (topic === "APP_UNINSTALLED" && session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  return new Response("OK", { status: 200 });
};
