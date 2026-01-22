import express from "express";
import { v4 as uuidv4 } from "uuid";

import { acquirePowerPlatformTokenOBO, getIncomingUserToken } from "./auth";
import { askCopilotStudioAgent } from "./copilotstudio";

import { AGENT_CARD_PATH, AgentCard, Message, Task } from "@a2a-js/sdk";
import {
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder
} from "@a2a-js/sdk/server/express";

const LOG_CHUNK_SIZE = Number(process.env.LOG_CHUNK_SIZE) || 8000;

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function logInChunks(prefix: string, value: unknown, chunkSize: number = LOG_CHUNK_SIZE): void {
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

function buildAgentCard(publicBaseUrl: string): AgentCard {
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

class ProxyExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    try {
      const parts =
        (requestContext as any)?.userMessage?.parts ??
        (requestContext as any)?.input?.parts ??
        (requestContext as any)?.message?.parts ??
        (requestContext as any)?.task?.input?.parts ??
        (requestContext as any)?.task?.message?.parts ??
        [];
      const textPart = parts.find((p: any) => p?.kind === "text");
      let userText: string = textPart?.text ?? "";

      if (!userText) {
        const history =
          (requestContext as any)?.history ??
          (requestContext as any)?.task?.history ??
          (requestContext as any)?.input?.history ??
          [];
        if (Array.isArray(history) && history.length > 0) {
          const lastUser = [...history].reverse().find((msg: any) => msg?.role === "user");
          const historyParts = Array.isArray(lastUser?.parts) ? lastUser.parts : [];
          const historyText = historyParts.find((p: any) => p?.kind === "text");
          userText = historyText?.text ?? "";
        }
      }

      if (!userText) {
        console.warn("ProxyExecutor: empty user message.", {
          keys: Object.keys(requestContext as any),
          hasHistory: Array.isArray((requestContext as any)?.history)
        });
      }

      const contextId =
        (requestContext as any)?.contextId ??
        (requestContext as any)?.message?.contextId ??
        (requestContext as any)?.userMessage?.contextId ??
        (requestContext as any)?.input?.contextId ??
        (requestContext as any)?.task?.contextId ??
        (requestContext as any)?.task?.message?.contextId;

      if (DEV_BYPASS_DOWNSTREAM) {
        const msg: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "agent",
          parts: [{ kind: "text", text: `Echo: ${userText}` }],
          contextId
        };
        eventBus.publish(msg);
        eventBus.finished();
        return;
      }

      const headers =
        ((requestContext as any)?.httpRequest?.headers ??
          (requestContext as any)?.context?.user?.rawHeaders ??
          {}) as Record<string, string | undefined>;
      const incomingUserToken = getIncomingUserToken(headers);
      if (!incomingUserToken) {
        console.error("Missing incoming user token. Available headers:", headers);
        throw new Error("Missing incoming user token (Authorization bearer or Easy Auth token headers).");
      }

      const ppToken = await acquirePowerPlatformTokenOBO(incomingUserToken);
      const downstreamText = await askCopilotStudioAgent(ppToken, userText);
      logInChunks("ProxyExecutor downstream response", downstreamText);

      const taskId = requestContext.taskId;
      const responseMsg: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ kind: "text", text: downstreamText }],
        contextId,
        taskId
      };

      // Publish a completed Task (not just a Message) so Copilot Studio knows the task is done
      const completedTask: Task = {
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
    } catch (error) {
      console.error("ProxyExecutor error:", error);
      const taskId = requestContext.taskId;
      const contextId = (requestContext as any).contextId;
      const errorMsg: Message = {
        kind: "message",
        messageId: uuidv4(),
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
      const failedTask: Task = {
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

  async cancelTask(): Promise<void> {
    return;
  }
}

export function buildExpressApp(publicBaseUrl: string) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
    
    res.json = (body: any) => {
      logInChunks("Outgoing response (json)", { path: req.path, status: res.statusCode, body });
      return originalJson(body);
    };
    res.send = (body?: any) => {
      logInChunks("Outgoing response (send)", { path: req.path, status: res.statusCode, body });
      return originalSend(body);
    };
    res.end = ((chunk?: any, encoding?: any, cb?: any) => {
      console.log(`Response ended for ${req.method} ${req.path} - status: ${res.statusCode}, headersSent: ${res.headersSent}, finished: ${res.writableFinished}`);
      return originalEnd(chunk, encoding, cb);
    }) as typeof res.end;

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
  const passthroughUserBuilder = async (req: express.Request) => ({
    isAuthenticated: false,
    userName: "",
    rawHeaders: req.headers
  });
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new ProxyExecutor()
  );
  const jsonRpc = jsonRpcHandler({
    requestHandler,
    userBuilder: passthroughUserBuilder as any
  });
  const rest = restHandler({
    requestHandler,
    userBuilder: passthroughUserBuilder as any
  });

  app.get("/.well-known/agent.json", (_req, res) => {
    res.status(200).json(agentCard);
  });
  const forwardJsonRpc = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const originalUrl = req.url;
    req.url = "/a2a/jsonrpc";
    jsonRpc(req, res, (err) => {
      req.url = originalUrl;
      if (err) return next(err);
      if (res.headersSent) return;
      return next();
    });
  };

  app.post("/.well-known/agent.json", (req, res, next) => {
    if (req.body && typeof req.body === "object" && "jsonrpc" in req.body) {
      return forwardJsonRpc(req, res, next);
    }
    res.status(200).json(agentCard);
  });

  app.get(`/${AGENT_CARD_PATH}`, agentCardHandler({
    agentCardProvider: requestHandler
  }));
  app.post(`/${AGENT_CARD_PATH}`, (req, res, next) => {
    if (req.body && typeof req.body === "object" && "jsonrpc" in req.body) {
      return forwardJsonRpc(req, res, next);
    }
    return agentCardHandler({
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

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Express error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message
    });
  });

  return app;
}
