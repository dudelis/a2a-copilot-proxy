"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askCopilotStudioAgent = void 0;
const https_1 = __importDefault(require("https"));
function extractTextFromAdaptiveCard(card) {
    const texts = [];
    const body = Array.isArray(card?.body) ? card.body : [];
    for (const item of body) {
        if (item?.type === "TextBlock" && typeof item?.text === "string") {
            texts.push(item.text);
        }
    }
    return texts;
}
function getCopilotStudioConfig() {
    const directLineTokenUrl = process.env.COPILOT_STUDIO_TOKEN_URL ??
        process.env.CS_DIRECT_CONNECT_URL;
    const directLineConversationUrl = process.env.COPILOT_STUDIO_CONVERSATION_URL;
    const botId = process.env.COPILOT_STUDIO_BOT_ID;
    const environmentUrl = process.env.COPILOT_STUDIO_ENVIRONMENT_URL;
    if (!directLineTokenUrl && !directLineConversationUrl && (!botId || !environmentUrl)) {
        throw new Error("Missing Copilot Studio config. Set COPILOT_STUDIO_CONVERSATION_URL or COPILOT_STUDIO_TOKEN_URL, or set COPILOT_STUDIO_BOT_ID + COPILOT_STUDIO_ENVIRONMENT_URL.");
    }
    return { botId, environmentUrl, directLineTokenUrl, directLineConversationUrl };
}
function normalizeConversationUrl(baseUrl, conversationId) {
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
async function readSseEvents(res) {
    const events = [];
    let buffer = "";
    for await (const chunk of res) {
        buffer += chunk.toString("utf8");
        buffer = buffer.replace(/\r\n/g, "\n");
        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = raw.split("\n").map((l) => l.trimEnd());
            const event = {};
            const dataLines = [];
            for (const line of lines) {
                if (line.startsWith("event:")) {
                    event.event = line.slice("event:".length).trim();
                }
                else if (line.startsWith("data:")) {
                    dataLines.push(line.slice("data:".length).trim());
                }
            }
            if (dataLines.length > 0) {
                event.data = dataLines.join("\n");
            }
            if (event.event || event.data) {
                events.push(event);
            }
            idx = buffer.indexOf("\n\n");
        }
    }
    return events;
}
async function postCopilotStudioSse(url, accessToken, body) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const payload = body ? JSON.stringify(body) : "";
        const options = {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "User-Agent": `A2AProxy/1.0 (${process.version})`,
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "Content-Length": Buffer.byteLength(payload)
            }
        };
        const req = https_1.default.request(target, options, async (res) => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                const events = await readSseEvents(res);
                resolve({ events, headers: res.headers });
                return;
            }
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                console.error("Copilot Studio SSE error response:", {
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
                reject(new Error(`Copilot Studio request failed: ${res.statusCode} ${data}`));
            });
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}
async function askCopilotStudioAgent(accessToken, userMessage) {
    try {
        const config = getCopilotStudioConfig();
        if (!config.directLineConversationUrl) {
            throw new Error("COPILOT_STUDIO_CONVERSATION_URL is required for Copilot Studio direct connect flow.");
        }
        const startUrl = normalizeConversationUrl(config.directLineConversationUrl);
        const start = await postCopilotStudioSse(startUrl, accessToken, {
            emitStartConversationEvent: true
        });
        const headerConversationId = start.headers["x-ms-conversationid"];
        const startActivity = start.events
            .map((evt) => (evt.event === "activity" && evt.data ? JSON.parse(evt.data) : null))
            .find((evt) => evt?.conversation?.id);
        const conversationId = headerConversationId ?? startActivity?.conversation?.id;
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
        });
        console.log("Copilot Studio SSE events:", send.events);
        const activities = send.events
            .map((evt) => (evt.event === "activity" && evt.data ? JSON.parse(evt.data) : null))
            .filter((evt) => evt?.type === "message");
        const botMessages = activities
            .map((evt) => {
            if (typeof evt?.text === "string" && evt.text.trim()) {
                return evt.text;
            }
            const attachments = Array.isArray(evt?.attachments) ? evt.attachments : [];
            const cardTexts = attachments
                .filter((att) => att?.contentType === "application/vnd.microsoft.card.adaptive")
                .flatMap((att) => extractTextFromAdaptiveCard(att?.content));
            return cardTexts.join("\n");
        })
            .filter((text) => typeof text === "string" && text.trim().length > 0);
        return botMessages.join("\n\n") || "No response from Copilot Studio agent.";
    }
    catch (error) {
        console.error("Copilot Studio communication error:", error);
        throw new Error(`Failed to communicate with Copilot Studio: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}
exports.askCopilotStudioAgent = askCopilotStudioAgent;
