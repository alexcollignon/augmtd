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
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
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

export async function getTokenFromCode(code: string, redirectUri: string) {
  const msalClient = getMSALClient();

  const tokenResponse = await msalClient.acquireTokenByCode({
    code,
    scopes: OUTLOOK_SCOPES,
    redirectUri,
  });

  return tokenResponse;
}

export async function refreshAccessToken(refreshToken: string) {
  const msalClient = getMSALClient();

  const tokenResponse = await msalClient.acquireTokenByRefreshToken({
    refreshToken,
    scopes: OUTLOOK_SCOPES,
  });

  return tokenResponse;
}
