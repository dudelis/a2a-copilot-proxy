import serverlessExpress from "@vendia/serverless-express";
import { buildExpressApp } from "../../server";

const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:7071";
const expressApp = buildExpressApp(publicBaseUrl);

// IMPORTANT: this handler expects (context, req) from the classic Functions model
const handler = serverlessExpress({ app: expressApp });

export default async function (context: any, req: any): Promise<void> {
  // delegate everything to serverless-express
  return handler(context, req);
}
