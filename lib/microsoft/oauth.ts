import { ConfidentialClientApplication } from '@azure/msal-node';

export function getMSALClient() {
  const config = {
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      authority: `https://login.microsoftonline.com/common`,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },
  };

  return new ConfidentialClientApplication(config);
}

export const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Files.Read.All',
  'offline_access',
];

export function getAuthUrl(redirectUri: string, state: string) {
  const msalClient = getMSALClient();

  return msalClient.getAuthCodeUrl({
    scopes: OUTLOOK_SCOPES,
    redirectUri,
    state,
    prompt: 'consent',
  });
}

/**
 * Exchange authorization code for tokens using direct HTTP request
 * This bypasses MSAL's cache and gives us access to the refresh token
 */
export async function getTokenFromCode(code: string, redirectUri: string) {
  const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: OUTLOOK_SCOPES.join(' '),
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();

  // Calculate expiration timestamp
  const expiresOn = new Date();
  expiresOn.setSeconds(expiresOn.getSeconds() + data.expires_in);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresOn: expiresOn.toISOString(),
    idToken: data.id_token,
  };
}

/**
 * Refresh access token using refresh token
 * This works in serverless environments without MSAL cache
 */
export async function refreshAccessToken(refreshToken: string) {
  const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: OUTLOOK_SCOPES.join(' '),
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();

  // Calculate expiration timestamp
  const expiresOn = new Date();
  expiresOn.setSeconds(expiresOn.getSeconds() + data.expires_in);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // Microsoft returns a new refresh token
    expiresOn: expiresOn.toISOString(),
  };
}

