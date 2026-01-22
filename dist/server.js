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
const LOG_CHUNK_SIZE = Number(process.env.LOG_CHUNK_SIZE) || 8000;
function safeStringify(value) {
    try {
        return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
function logInChunks(prefix, value, chunkSize = LOG_CHUNK_SIZE) {
    const text = safeStringify(value);
    const safeSize = Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : 8000;
    if (text.length <= safeSize) {
        console.log(`${prefix}:`, text);
        return;
    }
    const totalChunks = Math.ceil(text.length / safeSize);
    for (let i = 0, chunk = 1; i < text.length; i += safeSize, chunk++) {
        const end = Math.min(text.length, i + safeSize);
        console.log(`${prefix} [chunk ${chunk}/${totalChunks}, chars ${i}-${end}]:`, text.slice(i, end));
    }
}
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
            let userText = textPart?.text ?? "";
            if (!userText) {
                const history = requestContext?.history ??
                    requestContext?.task?.history ??
                    requestContext?.input?.history ??
                    [];
                if (Array.isArray(history) && history.length > 0) {
                    const lastUser = [...history].reverse().find((msg) => msg?.role === "user");
                    const historyParts = Array.isArray(lastUser?.parts) ? lastUser.parts : [];
                    const historyText = historyParts.find((p) => p?.kind === "text");
                    userText = historyText?.text ?? "";
                }
            }
            if (!userText) {
                console.warn("ProxyExecutor: empty user message.", {
                    keys: Object.keys(requestContext),
                    hasHistory: Array.isArray(requestContext?.history)
                });
            }
            const contextId = requestContext?.contextId ??
                requestContext?.message?.contextId ??
                requestContext?.userMessage?.contextId ??
                requestContext?.input?.contextId ??
                requestContext?.task?.contextId ??
                requestContext?.task?.message?.contextId;
            if (DEV_BYPASS_DOWNSTREAM) {
                const msg = {
                    kind: "message",
                    messageId: (0, uuid_1.v4)(),
                    role: "agent",
                    parts: [{ kind: "text", text: `Echo: ${userText}` }],
                    contextId
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
            logInChunks("ProxyExecutor downstream response", downstreamText);
            const taskId = requestContext.taskId;
            const responseMsg = {
                kind: "message",
                messageId: (0, uuid_1.v4)(),
                role: "agent",
                parts: [{ kind: "text", text: downstreamText }],
                contextId,
                taskId
            };
            // Publish a completed Task (not just a Message) so Copilot Studio knows the task is done
            const completedTask = {
                kind: "task",
                id: taskId,
                contextId,
                status: {
                    state: "completed",
                    message: responseMsg,
                    timestamp: new Date().toISOString()
                },
                history: [responseMsg]
            };
            eventBus.publish(completedTask);
            eventBus.finished();
            console.log("ProxyExecutor finished response with completed Task:", taskId);
        }
        catch (error) {
            console.error("ProxyExecutor error:", error);
            const taskId = requestContext.taskId;
            const contextId = requestContext.contextId;
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
                contextId,
                taskId
            };
            // Publish a failed Task so Copilot Studio knows the task is done (even with error)
            const failedTask = {
                kind: "task",
                id: taskId,
                contextId,
                status: {
                    state: "failed",
                    message: errorMsg,
                    timestamp: new Date().toISOString()
                },
                history: [errorMsg]
            };
            eventBus.publish(failedTask);
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
        const headers = { ...req.headers };
        if (headers.authorization) {
            headers.authorization = "[redacted]";
        }
        if (headers["x-ms-token-aad-access-token"]) {
            headers["x-ms-token-aad-access-token"] = "[redacted]";
        }
        if (headers["x-ms-token-aad-id-token"]) {
            headers["x-ms-token-aad-id-token"] = "[redacted]";
        }
        logInChunks("Incoming request", {
            method: req.method,
            path: req.path,
            contentLength: req.headers["content-length"],
            headers,
            body: req.body
        });
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        const originalEnd = res.end.bind(res);
        res.json = (body) => {
            logInChunks("Outgoing response (json)", { path: req.path, status: res.statusCode, body });
            return originalJson(body);
        };
        res.send = (body) => {
            logInChunks("Outgoing response (send)", { path: req.path, status: res.statusCode, body });
            return originalSend(body);
        };
        res.end = ((chunk, encoding, cb) => {
            console.log(`Response ended for ${req.method} ${req.path} - status: ${res.statusCode}, headersSent: ${res.headersSent}, finished: ${res.writableFinished}`);
            return originalEnd(chunk, encoding, cb);
        });
        next();
    });
    app.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        // Force connection close to prevent keep-alive issues with A2A clients
        res.setHeader("Connection", "close");
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
    const jsonRpc = (0, express_2.jsonRpcHandler)({
        requestHandler,
        userBuilder: passthroughUserBuilder
    });
    const rest = (0, express_2.restHandler)({
        requestHandler,
        userBuilder: passthroughUserBuilder
    });
    app.get("/.well-known/agent.json", (_req, res) => {
        res.status(200).json(agentCard);
    });
    const forwardJsonRpc = (req, res, next) => {
        const originalUrl = req.url;
        req.url = "/a2a/jsonrpc";
        jsonRpc(req, res, (err) => {
            req.url = originalUrl;
            if (err)
                return next(err);
            if (res.headersSent)
                return;
            return next();
        });
    };
    app.post("/.well-known/agent.json", (req, res, next) => {
        if (req.body && typeof req.body === "object" && "jsonrpc" in req.body) {
            return forwardJsonRpc(req, res, next);
        }
        res.status(200).json(agentCard);
    });
    app.get(`/${sdk_1.AGENT_CARD_PATH}`, (0, express_2.agentCardHandler)({
        agentCardProvider: requestHandler
    }));
    app.post(`/${sdk_1.AGENT_CARD_PATH}`, (req, res, next) => {
        if (req.body && typeof req.body === "object" && "jsonrpc" in req.body) {
            return forwardJsonRpc(req, res, next);
        }
        return (0, express_2.agentCardHandler)({
            agentCardProvider: requestHandler
        })(req, res, next);
    });
    app.use("/a2a/jsonrpc", jsonRpc);
    app.use("/a2a/rest", rest);
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
