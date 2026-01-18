import https from "https";

interface CopilotStudioConfig {
  botId: string;
  tenantId: string;
  environmentUrl: string;
  tokenEndpoint?: string;
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

const config: CopilotStudioConfig = {
  botId: process.env.COPILOT_STUDIO_BOT_ID!,
  tenantId: process.env.AZURE_TENANT_ID!,
  environmentUrl: process.env.COPILOT_STUDIO_ENVIRONMENT_URL!
};

/**
 * Start a Direct Line conversation with Copilot Studio
 */
async function startDirectLineConversation(accessToken: string): Promise<DirectLineToken> {
  const tokenEndpoint = `${config.environmentUrl}/powervirtualagents/bots/${config.botId}/directline/token?api-version=2022-03-01-preview`;

  return new Promise((resolve, reject) => {
    const url = new URL(tokenEndpoint);
    const options = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    };

    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse Direct Line token response: ${error}`));
          }
        } else {
          reject(new Error(`Failed to get Direct Line token: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Send a message via Direct Line API
 */
async function sendDirectLineMessage(
  conversationId: string,
  token: string,
  message: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`);
    
    const activity = {
      type: "message",
      from: { id: "user" },
      text: message
    };

    const postData = JSON.stringify(activity);
    
    const options = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(data).id);
        } else {
          reject(new Error(`Failed to send message: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Get activities from Direct Line conversation
 */
async function getDirectLineActivities(
  conversationId: string,
  token: string,
  watermark?: string
): Promise<{ activities: DirectLineActivity[]; watermark: string }> {
  return new Promise((resolve, reject) => {
    const urlPath = watermark 
      ? `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities?watermark=${watermark}`
      : `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`;
    
    const url = new URL(urlPath);
    
    const options = {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    };

    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          const response = JSON.parse(data);
          resolve({
            activities: response.activities || [],
            watermark: response.watermark
          });
        } else {
          reject(new Error(`Failed to get activities: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Poll for bot response with timeout
 */
async function pollForBotResponse(
  conversationId: string,
  token: string,
  initialWatermark: string,
  timeoutMs: number = 30000
): Promise<string> {
  const startTime = Date.now();
  let watermark = initialWatermark;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every second

    const { activities, watermark: newWatermark } = await getDirectLineActivities(
      conversationId,
      token,
      watermark
    );

    watermark = newWatermark;

    // Find bot messages
    const botMessages = activities
      .filter(a => a.type === "message" && a.from.id !== "user")
      .map(a => a.text)
      .filter(Boolean);

    if (botMessages.length > 0) {
      return botMessages.join("\n\n");
    }
  }

  throw new Error("Timeout waiting for bot response");
}

/**
 * Main function to ask Copilot Studio agent
 */
export async function askCopilotStudioAgent(accessToken: string, userMessage: string): Promise<string> {
  try {
    console.log("Starting Direct Line conversation with Copilot Studio...");
    
    // Start conversation and get Direct Line token
    const dlToken = await startDirectLineConversation(accessToken);
    console.log(`Conversation started: ${dlToken.conversationId}`);

    // Get initial watermark
    const { watermark } = await getDirectLineActivities(dlToken.conversationId, dlToken.token);

    // Send message
    await sendDirectLineMessage(dlToken.conversationId, dlToken.token, userMessage);
    console.log("Message sent, waiting for response...");

    // Poll for bot response
    const response = await pollForBotResponse(dlToken.conversationId, dlToken.token, watermark);
    
    return response || "No response from Copilot Studio agent.";
  } catch (error) {
    console.error("Copilot Studio communication error:", error);
    throw new Error(`Failed to communicate with Copilot Studio: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}