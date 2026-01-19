"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExpressApp = void 0;
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const auth_1 = require("./auth");
const copilotstudio_1 = require("./copilotstudio");
const sdk_1 = require("@a2a-js/sdk");
const server_1 = require("@a2a-js/sdk/server");
const express_2 = require("@a2a-js/sdk/server/express");
const DEV_BYPASS_DOWNSTREAM = (process.env.DEV_BYPASS_DOWNSTREAM || "").toLowerCase() === "true";
function buildAgentCard(publicBaseUrl) {
    return {
        name: "Copilot Studio A2A Proxy",
        description: "A2A endpoint that proxies requests to a downstream Copilot Studio agent via OBO.",
        protocolVersion: "0.3.0",
        version: "0.1.0",
        url: `${publicBaseUrl}/a2a/jsonrpc`,
        skills: [
            {
                id: "chat",
                name: "Chat",
                description: "Send a message to downstream Copilot Studio agent.",
                tags: ["copilot", "copilotstudio", "a2a", "proxy"]
            }
        ],
        capabilities: {
            pushNotifications: false
        },
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
        additionalInterfaces: [
            { url: `${publicBaseUrl}/a2a/jsonrpc`, transport: "JSONRPC" },
            { url: `${publicBaseUrl}/a2a/rest`, transport: "HTTP+JSON" }
        ]
    };
}
class ProxyExecutor {
    async execute(requestContext, eventBus) {
        try {
            const parts = requestContext?.userMessage?.parts ??
                requestContext?.input?.parts ??
                requestContext?.message?.parts ??
                requestContext?.task?.input?.parts ??
                requestContext?.task?.message?.parts ??
                [];
            const textPart = parts.find((p) => p?.kind === "text");
            const userText = textPart?.text ?? "";
            if (DEV_BYPASS_DOWNSTREAM) {
                const msg = {
                    kind: "message",
                    messageId: (0, uuid_1.v4)(),
                    role: "agent",
                    parts: [{ kind: "text", text: `Echo: ${userText}` }],
                    contextId: requestContext.contextId
                };
                eventBus.publish(msg);
                eventBus.finished();
                return;
            }
            const headers = (requestContext?.httpRequest?.headers ??
                requestContext?.context?.user?.rawHeaders ??
                {});
            const incomingUserToken = (0, auth_1.getIncomingUserToken)(headers);
            if (!incomingUserToken) {
                console.error("Missing incoming user token. Available headers:", headers);
                throw new Error("Missing incoming user token (Authorization bearer or Easy Auth token headers).");
            }
            const ppToken = await (0, auth_1.acquirePowerPlatformTokenOBO)(incomingUserToken);
            const downstreamText = await (0, copilotstudio_1.askCopilotStudioAgent)(ppToken, userText);
            const msg = {
                kind: "message",
                messageId: (0, uuid_1.v4)(),
                role: "agent",
                parts: [{ kind: "text", text: downstreamText }],
                contextId: requestContext.contextId
            };
            eventBus.publish(msg);
            eventBus.finished();
        }
        catch (error) {
            console.error("ProxyExecutor error:", error);
            const errorMsg = {
                kind: "message",
                messageId: (0, uuid_1.v4)(),
                role: "agent",
                parts: [
                    {
                        kind: "text",
                        text: `Error processing request: ${error instanceof Error ? error.message : "Unknown error"}`
                    }
                ],
                contextId: requestContext.contextId
            };
            eventBus.publish(errorMsg);
            eventBus.finished();
        }
    }
    async cancelTask() {
        return;
    }
}
function buildExpressApp(publicBaseUrl) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") {
            res.status(200).end();
            return;
        }
        next();
    });
    const agentCard = buildAgentCard(publicBaseUrl);
    const passthroughUserBuilder = async (req) => ({
        isAuthenticated: false,
        userName: "",
        rawHeaders: req.headers
    });
    const requestHandler = new server_1.DefaultRequestHandler(agentCard, new server_1.InMemoryTaskStore(), new ProxyExecutor());
    app.get("/.well-known/agent.json", (_req, res) => {
        res.status(200).json(agentCard);
    });
    app.get(`/${sdk_1.AGENT_CARD_PATH}`, (0, express_2.agentCardHandler)({
        agentCardProvider: requestHandler
    }));
    app.use("/a2a/jsonrpc", (0, express_2.jsonRpcHandler)({
        requestHandler,
        userBuilder: passthroughUserBuilder
    }));
    app.use("/a2a/rest", (0, express_2.restHandler)({
        requestHandler,
        userBuilder: passthroughUserBuilder
    }));
    app.get("/health", (_req, res) => {
        res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString()
        });
    });
    app.use((req, res) => {
        res.status(404).json({
            error: "Not found",
            path: req.path
        });
    });
    app.use((err, _req, res, _next) => {
        console.error("Express error:", err);
        res.status(500).json({
            error: "Internal server error",
            message: err.message
        });
    });
    return app;
}
exports.buildExpressApp = buildExpressApp;
