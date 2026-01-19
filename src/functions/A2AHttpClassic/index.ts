import serverlessExpress from "@vendia/serverless-express";
import { buildExpressApp } from "../../server";

const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:7071";
const expressApp = buildExpressApp(publicBaseUrl);

const handler = serverlessExpress({
  app: expressApp,
  eventSourceName: "AZURE_HTTP_FUNCTION_V4"
});

console.log("A2AHttpClassic module loaded");

export default async function (context: any, req: any): Promise<void> {
  try {
    console.log("A2AHttpClassic invoked", { method: req?.method, url: req?.url });
    return await handler(context, req);
  } catch (error) {
    console.error("A2AHttpClassic handler error:", error);
    throw error;
  }
}
