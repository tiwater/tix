/**
 * DingTalk Authentication & Token Management.
 * Adapted from OpenTix's dingtalk-plugin.
 */

import axios from 'axios';

interface TokenCache {
  accessToken: string;
  expiry: number;
}

const accessTokenCache = new Map<string, TokenCache>();

export async function getAccessToken(
  clientId: string,
  clientSecret: string,
  log?: any,
): Promise<string> {
  const cacheKey = clientId;
  const now = Date.now();
  const cached = accessTokenCache.get(cacheKey);

  if (cached && cached.expiry > now + 60000) {
    return cached.accessToken;
  }

  try {
    const response = await axios.post(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      {
        appKey: clientId,
        appSecret: clientSecret,
      },
      { headers: { 'Content-Type': 'application/json' } },
    );

    accessTokenCache.set(cacheKey, {
      accessToken: response.data.accessToken,
      expiry: now + response.data.expireIn * 1000,
    });

    return response.data.accessToken;
  } catch (err: any) {
    log?.error?.(`[DingTalk] Failed to get access token: ${err.message}`);
    throw err;
  }
}
