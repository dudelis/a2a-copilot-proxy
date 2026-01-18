import { ConfidentialClientApplication } from "@azure/msal-node";

/**
 * Extracts a bearer token from Authorization header.
 * Works for:
 *   Authorization: Bearer <token>
 */
export function getBearerTokenFromAuthHeader(authHeader?: string): string | null {
  if (!authHeader) return null;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return null;
  const token = authHeader.slice(prefix.length).trim();
  return token.length ? token : null;
}

/**
 * Azure App Service / Functions Easy Auth sometimes forwards the access token in headers.
 * Depending on configuration, you may see:
 *   x-ms-token-aad-access-token
 *
 * This helper tries both Authorization and Easy Auth header names.
 */
export function getIncomingUserToken(headers: Record<string, string | undefined>): string | null {
  const authz = headers["authorization"] ?? headers["Authorization"];
  const fromAuthz = getBearerTokenFromAuthHeader(authz);
  if (fromAuthz) return fromAuthz;

  const easyAuthToken =
    headers["x-ms-token-aad-access-token"] ??
    headers["X-MS-TOKEN-AAD-ACCESS-TOKEN"] ??
    headers["x-ms-token-aad-id-token"] ??
    headers["X-MS-TOKEN-AAD-ID-TOKEN"];

  return easyAuthToken?.trim() || null;
}

/**
 * OBO: exchange incoming user token for a Power Platform API token.
 */
export async function acquirePowerPlatformTokenOBO(userToken: string): Promise<string> {
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CS_INVOKE_CLIENT_ID;
  const clientSecret = process.env.CS_INVOKE_CLIENT_SECRET;
  const resource = process.env.POWERPLATFORM_RESOURCE;

  if (!tenantId || !clientId || !clientSecret || !resource) {
    throw new Error("Missing env vars for OBO (TENANT_ID, CS_INVOKE_CLIENT_ID, CS_INVOKE_CLIENT_SECRET, POWERPLATFORM_RESOURCE).");
  }

  const cca = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`
    }
  });

  // OBO uses resource/.default to request the delegated permissions your app has.
  const result = await cca.acquireTokenOnBehalfOf({
    oboAssertion: userToken,
    scopes: [`${resource}/.default`]
  });

  if (!result?.accessToken) {
    throw new Error("OBO failed: no access token returned.");
  }

  return result.accessToken;
}
