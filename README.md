# A2A Proxy for Copilot Studio

An Azure Functions-based proxy that implements the [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A) to expose a Copilot Studio agent as an A2A-compatible endpoint. This enables Copilot Studio agents to communicate with other A2A-compliant agents, including other Copilot Studio agents.

## Problem Statement

### The Challenge

**Copilot Studio agents cannot natively communicate with each other or with external A2A-compatible systems.**

Copilot Studio uses a proprietary Direct Line API for agent communication, while the industry is moving toward the open [A2A (Agent-to-Agent) protocol](https://github.com/google/A2A) for interoperability between AI agents. This creates several challenges:

1. **Agent Isolation**: Each Copilot Studio agent operates independently, unable to leverage capabilities of other specialized agents
2. **No Standard Protocol**: Copilot Studio's Direct Line API is not compatible with A2A protocol clients
3. **Limited Reusability**: You can't easily reuse a Copilot Studio agent from other platforms or orchestrators that support A2A
4. **Authentication Complexity**: Even if protocols aligned, token formats and audiences differ between systems

### The Solution

This **A2A Proxy** acts as a bridge:

```
┌──────────────────────────────────┐         ┌──────────────────────────────────┐
│  ANY A2A-COMPATIBLE CLIENT       │         │  YOUR COPILOT STUDIO AGENT       │
│  ─────────────────────────────   │         │  ─────────────────────────────   │
│  • Other Copilot Studio agents   │         │  • Specialized knowledge         │
│  • Custom A2A orchestrators      │   A2A   │  • Connected to internal systems │
│  • Third-party AI platforms      │ ◄─────► │  • Custom plugins/connectors     │
│  • Any OAuth + A2A client        │ Proxy   │  • Trained on your data          │
└──────────────────────────────────┘         └──────────────────────────────────┘
```

**Now you can:**
- ✅ Call a Copilot Studio agent from **another Copilot Studio agent** using A2A
- ✅ Integrate Copilot Studio into **any A2A-compatible orchestration framework**
- ✅ Expose your agent to **external partners** using the standard A2A protocol
- ✅ Build **multi-agent systems** where specialized agents collaborate
- ✅ Use standard **OAuth 2.0 authentication** for secure agent-to-agent communication

### Example Use Cases

| Scenario | How A2A Proxy Helps |
|----------|---------------------|
| **HR + IT Support** | HR Copilot calls IT Copilot via A2A to check equipment availability when onboarding new employees |
| **Sales + Inventory** | Sales Copilot queries Inventory Copilot via A2A to confirm stock before promising delivery dates |
| **Multi-tenant Platform** | External partners call your Copilot via A2A using their own OAuth tokens |
| **Agent Orchestration** | A central orchestrator routes requests to specialized Copilot agents based on intent |
| **Gradual Migration** | Expose legacy Copilot agents via A2A while building new agents on different platforms |

## Architecture

```
┌─────────────────────────┐                              ┌──────────────────────────┐
│    Copilot Studio       │                              │   Downstream Copilot     │
│    (A2A Caller)         │                              │   Studio Agent           │
└───────────┬─────────────┘                              └──────────────────────────┘
            │                                                        ▲
            │ A2A Protocol                                           │
            │ (JSON-RPC)                                             │ Direct Line API
            │ Token: api://app-id/access_as_user                    │ (SSE Streaming)
            ▼                                                        │
┌─────────────────────────────────────────────────────────────────────┴──────────────┐
│                           Azure Function (A2A Proxy)                               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Easy Auth      │───►│  A2A SDK        │───►│  OBO Token Exchange             │ │
│  │  (validates     │    │  (JSON-RPC      │    │  (exchanges token for           │ │
│  │   incoming      │    │   handler)      │    │   CopilotStudio.Copilots.Invoke)│ │
│  │   token)        │    │                 │    │                                 │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Features

- **A2A Protocol Support**: Implements A2A JSON-RPC endpoints for agent-to-agent communication
- **On-Behalf-Of (OBO) Flow**: Securely exchanges incoming tokens for Copilot Studio API tokens
- **SSE Streaming**: Handles Server-Sent Events streaming from downstream Copilot Studio agents
- **Easy Auth Integration**: Uses Azure App Service Authentication for token validation

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Azure Functions Core Tools](https://docs.microsoft.com/azure/azure-functions/functions-run-local) (v4)
- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli)
- An Azure subscription
- A Copilot Studio agent (downstream agent to proxy to)

## Azure App Registration Setup

You need **one App Registration** that serves dual purposes:
1. **Authenticates incoming requests** to the Azure Function (via Easy Auth)
2. **Performs OBO token exchange** to call downstream Copilot Studio

### Step 1: Create App Registration

1. Go to **Azure Portal** → **Microsoft Entra ID** → **App registrations**
2. Click **New registration**
3. Name: `a2a-copilot-proxy` (or your preferred name)
4. Supported account types: **Accounts in this organizational directory only**
5. Redirect URI: Leave blank for now
6. Click **Register**

### Step 2: Expose an API

1. In your app registration, go to **Expose an API**
2. Click **Add** next to "Application ID URI"
3. Accept the default `api://<client-id>` or customize it
4. Click **Add a scope**:
   - Scope name: `access_as_user`
   - Who can consent: **Admins and users**
   - Admin consent display name: `Access A2A Proxy as user`
   - Admin consent description: `Allows the app to access A2A Proxy on behalf of the signed-in user`
   - State: **Enabled**
5. Note the full scope: `api://<client-id>/access_as_user`

### Step 3: Add API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **APIs my organization uses**
4. Search for `Power Platform API` or `CopilotStudio`
5. Select **Delegated permissions**
6. Check `CopilotStudio.Copilots.Invoke`
7. Click **Add permissions**
8. Click **Grant admin consent for [your tenant]**

### Step 4: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `a2a-proxy-secret`
4. Expiration: Choose appropriate duration
5. Click **Add**
6. **Copy the secret value immediately** (you won't see it again)

### Step 5: Configure Authentication (for Easy Auth)

1. Go to your **Azure Function App** in Azure Portal
2. Go to **Authentication**
3. Click **Add identity provider**
4. Select **Microsoft**
5. Choose **Provide the details of an existing app registration**
6. Enter:
   - Application (client) ID: Your app registration's client ID
   - Client secret: The secret you created
   - Issuer URL: `https://login.microsoftonline.com/<tenant-id>/v2.0`
7. Set **Unauthenticated requests**: `Return 401 Unauthorized`
8. Click **Add**

### Step 6: Configure Copilot Studio (Caller Agent)

In Copilot Studio, when configuring the A2A connector to call your proxy:

1. Go to your Copilot Studio agent → **Settings** → **Generative AI** → **Agent-to-Agent**
2. Add your A2A endpoint URL: `https://<your-function>.azurewebsites.net/a2a/jsonrpc`
3. Configure authentication:
   - Authentication type: **Microsoft Entra ID**
   - Client ID: Your app registration's client ID
   - Scope: `api://<client-id>/access_as_user`

## Configuration

### Environment Variables

Copy `local.settings.sample.json` to `local.settings.json` and configure:

| Variable | Description | Example |
|----------|-------------|---------|
| `TENANT_ID` | Your Azure AD tenant ID | `12345678-1234-1234-1234-123456789abc` |
| `COPILOT_INVOKE_CLIENT_ID` | App registration client ID | `87654321-4321-4321-4321-cba987654321` |
| `COPILOT_INVOKE_CLIENT_SECRET` | App registration client secret | `your-client-secret-here` |
| `POWERPLATFORM_RESOURCE` | Power Platform API resource | `https://api.powerplatform.com` |
| `COPILOT_STUDIO_CONVERSATION_URL` | Direct Line conversation URL | See below |
| `COPILOT_STUDIO_BOT_ID` | Bot ID from Copilot Studio | `cr56b_myBotName` |
| `COPILOT_STUDIO_ENVIRONMENT_URL` | Environment API URL | See below |
| `PUBLIC_BASE_URL` | Public URL of your function | `https://your-func.azurewebsites.net` |
| `DEV_BYPASS_DOWNSTREAM` | Skip downstream call (dev only) | `false` |

### Finding Copilot Studio URLs

1. Go to **Copilot Studio** → Your agent → **Channels** → **Direct Line**
2. Copy the **Token Endpoint** URL
3. Extract:
   - **Environment URL**: The base URL (e.g., `https://xxxxx.environment.api.powerplatform.com`)
   - **Bot ID**: The bot identifier in the URL path
   - **Conversation URL**: The full conversations endpoint

Example:
```
Token URL: https://602ccc.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr56b_myBot/...

Environment URL: https://602ccc.environment.api.powerplatform.com
Bot ID: cr56b_myBot
Conversation URL: https://602ccc.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr56b_myBot/conversations?api-version=2022-03-01-preview
```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy and configure settings:
   ```bash
   cp local.settings.sample.json local.settings.json
   # Edit local.settings.json with your values
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the function locally:
   ```bash
   npm start
   ```

5. Test the agent card endpoint:
   ```bash
   curl http://localhost:7071/.well-known/agent.json
   ```

## Deployment

### Deploy to Azure

```bash
# Login to Azure
az login

# Deploy the function
func azure functionapp publish <your-function-app-name>
```

### Configure App Settings in Azure

Set the environment variables in your Function App:

```bash
az functionapp config appsettings set \
  --name <your-function-app-name> \
  --resource-group <your-resource-group> \
  --settings \
    TENANT_ID="<your-tenant-id>" \
    COPILOT_INVOKE_CLIENT_ID="<your-client-id>" \
    COPILOT_INVOKE_CLIENT_SECRET="<your-client-secret>" \
    POWERPLATFORM_RESOURCE="https://api.powerplatform.com" \
    COPILOT_STUDIO_CONVERSATION_URL="<your-conversation-url>" \
    COPILOT_STUDIO_BOT_ID="<your-bot-id>" \
    COPILOT_STUDIO_ENVIRONMENT_URL="<your-environment-url>" \
    PUBLIC_BASE_URL="https://<your-function>.azurewebsites.net"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | A2A Agent Card |
| `/a2a/jsonrpc` | POST | A2A JSON-RPC endpoint |
| `/a2a/rest` | POST | A2A REST endpoint |
| `/health` | GET | Health check |

## Troubleshooting

### "Missing incoming user token" Error

- Ensure Easy Auth is configured on your Azure Function
- Verify the caller is sending a valid Bearer token
- Check that the token's audience matches your app registration

### OBO Token Exchange Fails

- Verify `CopilotStudio.Copilots.Invoke` permission has admin consent
- Check that `COPILOT_INVOKE_CLIENT_SECRET` is correct and not expired
- Ensure `TENANT_ID` matches your Azure AD tenant

### Downstream Copilot Studio Not Responding

- Verify the `COPILOT_STUDIO_CONVERSATION_URL` is correct
- Check that the bot is published and accessible
- Review Azure Function logs for SSE streaming errors

### Second A2A Call Never Executes

- This was fixed by returning a proper `Task` with `status.state: "completed"` instead of just a `Message`
- Ensure you're using the latest version of this proxy

## License

MIT
