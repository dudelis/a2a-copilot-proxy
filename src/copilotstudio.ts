import https from "https";
import { IncomingMessage } from "http";

// Create a fresh HTTPS agent for each request to avoid any connection state issues
// that could block subsequent requests
function createHttpsAgent(): https.Agent {
  return new https.Agent({
    keepAlive: false,
    maxSockets: 1,  // One socket per agent to ensure clean state
    timeout: 120000
  });
}

interface CopilotStudioConfig {
  botId?: string;
  environmentUrl?: string;
  directLineTokenUrl?: string;
  directLineConversationUrl?: string;
}

interface DirectLineToken {
  conversationId: string;
  token: string;
  expires_in: number;
}

interface DirectLineActivity {
  type: string;
  id: string;
  timestamp: string;
  from: {
    id: string;
    name?: string;
  };
  text?: string;
  attachments?: any[];
}

type SseEvent = {
  event?: string;
  data?: string;
};

type SseReadOptions = {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  stopOnFirstMessage?: boolean;
};

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

function extractTextFromAdaptiveCard(card: any): string[] {
  const texts: string[] = [];
  const body = Array.isArray(card?.body) ? card.body : [];
  for (const item of body) {
    if (item?.type === "TextBlock" && typeof item?.text === "string") {
      texts.push(item.text);
    }
  }
  return texts;
}

function getCopilotStudioConfig(): CopilotStudioConfig {
  const directLineTokenUrl =
    process.env.COPILOT_STUDIO_TOKEN_URL ??
    process.env.CS_DIRECT_CONNECT_URL;
  const directLineConversationUrl = process.env.COPILOT_STUDIO_CONVERSATION_URL;
  const botId = process.env.COPILOT_STUDIO_BOT_ID;
  const environmentUrl = process.env.COPILOT_STUDIO_ENVIRONMENT_URL;

  if (!directLineTokenUrl && !directLineConversationUrl && (!botId || !environmentUrl)) {
    throw new Error(
      "Missing Copilot Studio config. Set COPILOT_STUDIO_CONVERSATION_URL or COPILOT_STUDIO_TOKEN_URL, or set COPILOT_STUDIO_BOT_ID + COPILOT_STUDIO_ENVIRONMENT_URL."
    );
  }

  return { botId, environmentUrl, directLineTokenUrl, directLineConversationUrl };
}

function normalizeResponseText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeConversationUrl(baseUrl: string, conversationId?: string): string {
  const url = new URL(baseUrl);

  if (!url.searchParams.has("api-version")) {
    url.searchParams.append("api-version", "2022-03-01-preview");
  }

  if (url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  if (url.pathname.includes("/conversations")) {
    url.pathname = url.pathname.substring(0, url.pathname.indexOf("/conversations"));
  }

  url.pathname = `${url.pathname}/conversations`;
  if (conversationId) {
    url.pathname = `${url.pathname}/${conversationId}`;
  }

  return url.toString();
}

async function readSseEvents(res: IncomingMessage, options?: SseReadOptions): Promise<SseEvent[]> {
  const timeoutMs = options?.timeoutMs ?? (Number(process.env.COPILOT_STUDIO_SSE_TIMEOUT_MS) || 120000);
  const idleTimeoutMs =
    options?.idleTimeoutMs ?? (Number(process.env.COPILOT_STUDIO_SSE_IDLE_TIMEOUT_MS) || 15000);
  const stopOnFirstMessage = options?.stopOnFirstMessage ?? false;
  const events: SseEvent[] = [];
  let buffer = "";

  return new Promise((resolve, reject) => {
    let finished = false;
    let finishReason = "end";
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      logInChunks("Copilot Studio SSE finished", {
        reason: finishReason,
        events: events.length
      });
      resolve(events);
    };
    const timeout = setTimeout(() => {
      finishReason = "timeout";
      console.warn("Copilot Studio SSE timeout reached.", { timeoutMs, events: events.length });
      res.destroy();
      finish();
    }, timeoutMs);
    let idleTimeout = setTimeout(() => {
      finishReason = "idle-timeout";
      console.warn("Copilot Studio SSE idle timeout reached.", { idleTimeoutMs, events: events.length });
      res.destroy();
      finish();
    }, idleTimeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(idleTimeout);
      res.off("data", onData);
      res.off("end", onEnd);
      res.off("close", onClose);
      res.off("error", onError);
    };

    const onData = (chunk: Buffer) => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        finishReason = "idle-timeout";
        console.warn("Copilot Studio SSE idle timeout reached.", { idleTimeoutMs, events: events.length });
        res.destroy();
        finish();
      }, idleTimeoutMs);

      buffer += chunk.toString("utf8");
      buffer = buffer.replace(/\r\n/g, "\n");
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = raw.split("\n").map((l) => l.trimEnd());
        const event: SseEvent = {};
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            event.event = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trim());
          }
        }
        if (dataLines.length > 0) {
          event.data = dataLines.join("\n");
        }
        if (event.event || event.data) {
          events.push(event);
          logInChunks("Copilot Studio SSE raw event", {
            event: event.event,
            data: event.data
          });
          
          // Check for end/done/complete events (non-activity)
          if (event.event === "end" || event.event === "done" || event.event === "complete") {
            console.log("Copilot Studio SSE received end event:", event.event);
            finishReason = "end-event";
            res.destroy();
            finish();
            return;
          }
          
          if (stopOnFirstMessage && event.event === "activity" && event.data) {
            try {
              const payload = JSON.parse(event.data);
              if (payload?.type === "message") {
                finishReason = "first-message";
                res.destroy();
                finish();
                return;
              }
              const streamType = payload?.channelData?.streamType;
              const chunkType = payload?.channelData?.chunkType;
              // Check for final streaming chunk OR final message type
              if (
                streamType === "final" ||
                (streamType === "streaming" &&
                  (chunkType === "final" || chunkType === "done" || chunkType === "completed"))
              ) {
                finishReason = "streaming-final";
                res.destroy();
                finish();
                return;
              }
            } catch {
              // Ignore parse errors and keep reading.
            }
          } else if (event.event === "activity" && event.data) {
            try {
              const payload = JSON.parse(event.data);
              const streamType = payload?.channelData?.streamType;
              const chunkType = payload?.channelData?.chunkType;
              // Check for final streaming chunk OR final message type
              if (
                streamType === "final" ||
                (streamType === "streaming" &&
                  (chunkType === "final" || chunkType === "done" || chunkType === "completed"))
              ) {
                finishReason = "streaming-final";
                res.destroy();
                finish();
                return;
              }
              // A "message" type activity (not "typing") after streaming indicates the final response
              if (payload?.type === "message" && streamType !== "streaming") {
                finishReason = "message-received";
                res.destroy();
                finish();
                return;
              }
            } catch {
              // Ignore parse errors and keep reading.
            }
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    };

    const onEnd = () => {
      console.log("Copilot Studio SSE stream ended (onEnd)", { events: events.length });
      finishReason = "end";
      finish();
    };

    const onClose = () => {
      console.log("Copilot Studio SSE stream closed (onClose)", { events: events.length });
      finishReason = "close";
      finish();
    };

    const onError = (error: Error) => {
      console.error("Copilot Studio SSE stream error (onError)", { error: error.message, events: events.length });
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };

    res.on("data", onData);
    res.on("end", onEnd);
    res.on("close", onClose);
    res.on("error", onError);
  });
}

async function postCopilotStudioSse(
  url: string,
  accessToken: string,
  body?: Record<string, unknown>,
  readOptions?: SseReadOptions
): Promise<{ events: SseEvent[]; headers: IncomingMessage["headers"] }> {
  const requestId = Math.random().toString(36).substring(2, 10);
  console.log(`[${requestId}] Copilot Studio SSE request starting:`, JSON.stringify({ url, timestamp: new Date().toISOString() }));
  
  // Create a fresh agent for this request to avoid any connection pooling issues
  const agent = createHttpsAgent();
  
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body ? JSON.stringify(body) : "";
    const requestOptions: https.RequestOptions = {
      method: "POST",
      agent: agent,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": `A2AProxy/1.0 (${process.version})`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Content-Length": String(Buffer.byteLength(payload)),
        "Connection": "close"
      },
      timeout: 120000
    };

    const req = https.request(target, requestOptions, async (res) => {
      console.log(`[${requestId}] Copilot Studio SSE response received:`, JSON.stringify({ statusCode: res.statusCode }));
      
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const events = await readSseEvents(res, readOptions);
          console.log(`[${requestId}] Copilot Studio SSE completed successfully:`, JSON.stringify({ eventCount: events.length }));
          agent.destroy();  // Clean up the agent
          resolve({ events, headers: res.headers });
        } catch (err) {
          console.error(`[${requestId}] Copilot Studio SSE read error:`, err);
          agent.destroy();  // Clean up the agent on error
          reject(err);
        }
        return;
      }

      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        console.error(`[${requestId}] Copilot Studio SSE error response:`, JSON.stringify({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        }));
        agent.destroy();  // Clean up the agent
        reject(new Error(`Copilot Studio request failed: ${res.statusCode} ${data}`));
      });
    });

    req.on("timeout", () => {
      console.error(`[${requestId}] Copilot Studio SSE request timeout`);
      agent.destroy();  // Clean up the agent
      req.destroy(new Error("Request timeout"));
    });

    req.on("error", (err) => {
      console.error(`[${requestId}] Copilot Studio SSE request error:`, err);
      agent.destroy();  // Clean up the agent on error
      reject(err);
    });
    
    req.write(payload);
    req.end();
  });
}

export async function askCopilotStudioAgent(accessToken: string, userMessage: string): Promise<string> {
  const invocationId = Math.random().toString(36).substring(2, 10);
  console.log(`[${invocationId}] askCopilotStudioAgent ENTRY:`, JSON.stringify({ 
    messageLength: userMessage.length,
    messagePreview: userMessage.slice(0, 100),
    timestamp: new Date().toISOString()
  }));
  
  try {
    const config = getCopilotStudioConfig();
    if (!config.directLineConversationUrl) {
      throw new Error("COPILOT_STUDIO_CONVERSATION_URL is required for Copilot Studio direct connect flow.");
    }

    console.log(`[${invocationId}] Starting new conversation with Copilot Studio...`);
    const startUrl = normalizeConversationUrl(config.directLineConversationUrl);
    const start = await postCopilotStudioSse(startUrl, accessToken, {
      emitStartConversationEvent: true
    });

    const headerConversationId = start.headers["x-ms-conversationid"] as string | undefined;
    const startActivity = start.events
      .map((evt) => (evt.event === "activity" && evt.data ? JSON.parse(evt.data) : null))
      .find((evt) => evt?.conversation?.id);
    const conversationId = headerConversationId ?? startActivity?.conversation?.id;
    
    console.log(`[${invocationId}] Conversation started:`, JSON.stringify({ conversationId }));

    if (!conversationId) {
      throw new Error("Failed to obtain conversation id from Copilot Studio.");
    }

    const sendUrl = normalizeConversationUrl(config.directLineConversationUrl, conversationId);
    const send = await postCopilotStudioSse(sendUrl, accessToken, {
      activity: {
        type: "message",
        text: userMessage,
        conversation: { id: conversationId }
      }
    }, { stopOnFirstMessage: false });

    logInChunks("Copilot Studio SSE events", send.events);

    const activities = send.events
      .map((evt) => (evt.event === "activity" && evt.data ? JSON.parse(evt.data) : null))
      .filter((evt) => evt?.type);

    // Only extract text from the FINAL message (streamType === "final" or no streamType on a "message" type)
    // Ignore intermediate streaming chunks to avoid duplicate text
    const finalMessages = activities
      .filter((evt) => {
        // Final streaming message
        if (evt?.channelData?.streamType === "final") return true;
        // Regular message without streaming metadata (non-streaming response)
        if (evt?.type === "message" && !evt?.channelData?.streamType) return true;
        return false;
      })
      .map((evt) => {
        if (typeof evt?.text === "string" && evt.text.trim()) {
          return evt.text;
        }
        const attachments = Array.isArray(evt?.attachments) ? (evt.attachments as any[]) : [];
        const cardTexts = attachments
          .filter((att: any) => att?.contentType === "application/vnd.microsoft.card.adaptive")
          .flatMap((att: any) => extractTextFromAdaptiveCard(att?.content));
        return cardTexts.join("\n");
      })
      .filter((text) => typeof text === "string" && text.trim().length > 0);

    // Fallback: if no final message found, try to get text from streaming chunks (last one should have full text)
    let responseText = finalMessages.join("\n\n");
    
    if (!responseText) {
      const streamingActivities = activities
        .filter((evt) => evt?.type === "typing" && evt?.channelData?.streamType === "streaming");
      if (streamingActivities.length > 0) {
        // Use the LAST streaming chunk which should have the most complete text
        const lastStreaming = streamingActivities[streamingActivities.length - 1];
        responseText = typeof lastStreaming?.text === "string" ? lastStreaming.text : "";
      }
    }

    const cleaned = normalizeResponseText(responseText);
    const finalText = cleaned;
    
    logInChunks("Copilot Studio response", {
      finalMessageCount: finalMessages.length,
      finalMessages,
      finalText
    });

    console.log(`[${invocationId}] askCopilotStudioAgent EXIT:`, JSON.stringify({
      success: true,
      responseLength: finalText.length,
      timestamp: new Date().toISOString()
    }));

    return finalText || "No response from Copilot Studio agent.";
  } catch (error) {
    console.error(`[${invocationId}] askCopilotStudioAgent ERROR:`, JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }));
    console.error("Copilot Studio communication error:", error);
    throw new Error(
      `Failed to communicate with Copilot Studio: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
