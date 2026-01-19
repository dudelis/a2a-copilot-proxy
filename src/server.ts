import express from "express";
import { v4 as uuidv4 } from "uuid";

import { acquirePowerPlatformTokenOBO, getIncomingUserToken } from "./auth";
import { askCopilotStudioAgent } from "./copilotstudio";

import { AGENT_CARD_PATH, AgentCard, Message } from "@a2a-js/sdk";
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
      const userText: string = textPart?.text ?? "";

      if (DEV_BYPASS_DOWNSTREAM) {
        const msg: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "agent",
          parts: [{ kind: "text", text: `Echo: ${userText}` }],
          contextId: (requestContext as any).contextId
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

      const msg: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ kind: "text", text: downstreamText }],
        contextId: (requestContext as any).contextId
      };

      eventBus.publish(msg);
      eventBus.finished();
    } catch (error) {
      console.error("ProxyExecutor error:", error);
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
        contextId: (requestContext as any).contextId
      };
      eventBus.publish(errorMsg);
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

  app.get("/.well-known/agent.json", (_req, res) => {
    res.status(200).json(agentCard);
  });

  app.get(`/${AGENT_CARD_PATH}`, agentCardHandler({
    agentCardProvider: requestHandler
  }));

  app.use("/a2a/jsonrpc", jsonRpcHandler({
    requestHandler,
    userBuilder: passthroughUserBuilder as any
  }));

  app.use("/a2a/rest", restHandler({
    requestHandler,
    userBuilder: passthroughUserBuilder as any
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

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Express error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message
    });
  });

  return app;
}
