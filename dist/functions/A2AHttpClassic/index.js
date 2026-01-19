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
console.log("A2AHttpClassic module loaded");
async function default_1(context, req) {
    try {
        console.log("A2AHttpClassic invoked", { method: req?.method, url: req?.url });
        return await handler(context, req);
    }
    catch (error) {
        console.error("A2AHttpClassic handler error:", error);
        throw error;
    }
}
exports.default = default_1;
