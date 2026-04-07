/**
 * DingTalk Authentication & Token Management.
 * Adapted from OpenTix's dingtalk-plugin.
 */
import axios from 'axios';
const accessTokenCache = new Map();
export async function getAccessToken(clientId, clientSecret, log) {
    const cacheKey = clientId;
    const now = Date.now();
    const cached = accessTokenCache.get(cacheKey);
    if (cached && cached.expiry > now + 60000) {
        return cached.accessToken;
    }
    try {
        const response = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
            appKey: clientId,
            appSecret: clientSecret,
        }, { headers: { 'Content-Type': 'application/json' } });
        accessTokenCache.set(cacheKey, {
            accessToken: response.data.accessToken,
            expiry: now + response.data.expireIn * 1000,
        });
        return response.data.accessToken;
    }
    catch (err) {
        log?.error?.(`[DingTalk] Failed to get access token: ${err.message}`);
        throw err;
    }
}
//# sourceMappingURL=auth.js.map