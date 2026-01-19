"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquirePowerPlatformTokenOBO = exports.getIncomingUserToken = exports.getBearerTokenFromAuthHeader = void 0;
const msal_node_1 = require("@azure/msal-node");
function getBearerTokenFromAuthHeader(authHeader) {
    if (!authHeader)
        return null;
    const prefix = "Bearer ";
    if (!authHeader.startsWith(prefix))
        return null;
    const token = authHeader.slice(prefix.length).trim();
    return token.length ? token : null;
}
exports.getBearerTokenFromAuthHeader = getBearerTokenFromAuthHeader;
function getIncomingUserToken(headers) {
    const authz = headers["authorization"] ?? headers["Authorization"];
    const fromAuthz = getBearerTokenFromAuthHeader(authz);
    if (fromAuthz)
        return fromAuthz;
    const easyAuthToken = headers["x-ms-token-aad-access-token"] ??
        headers["X-MS-TOKEN-AAD-ACCESS-TOKEN"] ??
        headers["x-ms-token-aad-id-token"] ??
        headers["X-MS-TOKEN-AAD-ID-TOKEN"];
    return easyAuthToken?.trim() || null;
}
exports.getIncomingUserToken = getIncomingUserToken;
async function acquirePowerPlatformTokenOBO(userToken) {
    const tenantId = process.env.TENANT_ID;
    const clientId = process.env.COPILOT_INVOKE_CLIENT_ID;
    const clientSecret = process.env.COPILOT_INVOKE_CLIENT_SECRET;
    const resource = process.env.POWERPLATFORM_RESOURCE || "https://api.powerplatform.com";
    if (!tenantId || !clientId || !clientSecret) {
        throw new Error("Missing env vars for OBO (TENANT_ID, COPILOT_INVOKE_CLIENT_ID, COPILOT_INVOKE_CLIENT_SECRET).");
    }
    const cca = new msal_node_1.ConfidentialClientApplication({
        auth: {
            clientId,
            clientSecret,
            authority: `https://login.microsoftonline.com/${tenantId}`
        }
    });
    const result = await cca.acquireTokenOnBehalfOf({
        oboAssertion: userToken,
        scopes: [`${resource}/.default`]
    });
    if (!result?.accessToken) {
        throw new Error("OBO failed: no access token returned.");
    }
    try {
        const claims = JSON.parse(Buffer.from(result.accessToken.split(".")[1], "base64").toString("utf8"));
        console.log("OBO token claims (aud, scp):", { aud: claims?.aud, scp: claims?.scp });
    }
    catch {
        console.warn("Failed to decode OBO token claims.");
    }
    return result.accessToken;
}
exports.acquirePowerPlatformTokenOBO = acquirePowerPlatformTokenOBO;
