import express from "express";
import { v4 as uuidv4 } from "uuid";

import { acquirePowerPlatformTokenOBO, getIncomingUserToken } from "./auth";
import { askCopilotStudioAgent } from "./copilotstudio";

// A2A imports
import {
  AGENT_CARD_PATH,
  AgentCard,
  Message
} from "@a2a-js/sdk";

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

function buildAgentCard(publicBaseUrl: string): AgentCard {
  return {
    name: "CopilotStudio A2A Proxy",
    description: "A2A endpoint that proxies requests to a Copilot Studio agent in another environment via OBO.",
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
      // Extract incoming text from A2A request
      const parts = (requestContext as any)?.input?.parts ?? [];
      const textPart = parts.find((p: any) => p?.kind === "text");
      const userText: string = textPart?.text ?? "";

      // Extract user token forwarded by Easy Auth
      const headers = ((requestContext as any)?.httpRequest?.headers ?? {}) as Record<string, string | undefined>;
      const incomingUserToken = getIncomingUserToken(headers);
      
      if (!incomingUserToken) {
        throw new Error("Missing incoming user token (Authorization bearer or Easy Auth token headers).");
      }

      // OBO: get Power Platform API access token
      const ppToken = await acquirePowerPlatformTokenOBO(incomingUserToken);

      // Call downstream Copilot Studio agent
      const downstreamText = await askCopilotStudioAgent(ppToken, userText);

      // Publish response message
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
      
      // Send error message to user
      const errorMsg: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "agent",
        parts: [{ 
          kind: "text", 
          text: `Error processing request: ${error instanceof Error ? error.message : "Unknown error"}` 
        }],
        contextId: (requestContext as any).contextId
      };
      
      eventBus.publish(errorMsg);
      eventBus.finished();
    }
  }

  async cancelTask(): Promise<void> {
    // no-op for this implementation
  }
}

export function buildExpressApp(publicBaseUrl: string) {
  const app = express();

  // Essential middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS for development
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

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new ProxyExecutor()
  );
  app.get("/.well-known/agent.json", (_req, res) => {
    res.status(200).json(agentCard);
  });

  // Agent card discovery
  app.get(`/${AGENT_CARD_PATH}`, agentCardHandler({ 
    agentCardProvider: requestHandler 
  }));

  // A2A transports
  // Azure Function Easy Auth handles authentication, so noAuthentication is appropriate here
  app.use("/a2a/jsonrpc", jsonRpcHandler({ 
    requestHandler, 
    userBuilder: UserBuilder.noAuthentication 
  }));
  
  app.use("/a2a/rest", restHandler({ 
    requestHandler, 
    userBuilder: UserBuilder.noAuthentication 
  }));

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.status(200).json({ 
      status: "ok", 
      timestamp: new Date().toISOString() 
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ 
      error: "Not found", 
      path: req.path 
    });
  });

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Express error:", err);
    res.status(500).json({ 
      error: "Internal server error",
      message: err.message 
    });
  });

  return app;
}
