import serverlessExpress from "@vendia/serverless-express";
import { buildExpressApp } from "../../server";

const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:7071";
const expressApp = buildExpressApp(publicBaseUrl);

const handler = serverlessExpress({
  app: expressApp,
  eventSourceName: "AZURE_HTTP_FUNCTION_V4"
});

console.log("A2AHttpClassic module loaded at", new Date().toISOString());

let requestCounter = 0;

export default async function (context: any, req: any): Promise<void> {
  const reqNum = ++requestCounter;
  const startTime = Date.now();
  console.log(`[REQ#${reqNum}] A2AHttpClassic invoked at ${new Date().toISOString()}:`, JSON.stringify({ 
    method: req?.method, 
    url: req?.url,
    contentLength: req?.headers?.["content-length"],
    requestNum: reqNum
  }));
  
  try {
    const result = await handler(context, req);
    console.log(`[REQ#${reqNum}] A2AHttpClassic completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    console.error(`[REQ#${reqNum}] A2AHttpClassic handler error after ${Date.now() - startTime}ms:`, JSON.stringify({ 
      message: error instanceof Error ? error.message : String(error), 
      stack: error instanceof Error ? error.stack : undefined 
    }));
    throw error;
  }
}
