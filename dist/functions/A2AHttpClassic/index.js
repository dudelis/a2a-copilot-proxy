"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const serverless_express_1 = __importDefault(require("@vendia/serverless-express"));
const server_1 = require("../../server");
const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:7071";
const expressApp = (0, server_1.buildExpressApp)(publicBaseUrl);
const handler = (0, serverless_express_1.default)({
    app: expressApp,
    eventSourceName: "AZURE_HTTP_FUNCTION_V4"
});
console.log("A2AHttpClassic module loaded at", new Date().toISOString());
let requestCounter = 0;
async function default_1(context, req) {
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
    }
    catch (error) {
        console.error(`[REQ#${reqNum}] A2AHttpClassic handler error after ${Date.now() - startTime}ms:`, JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        }));
        throw error;
    }
}
exports.default = default_1;
