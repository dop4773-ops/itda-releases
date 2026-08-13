const { refreshAccessToken } = require('./oauth-flow');
const { loadCredentials } = require('./credentials');
const tokenStore = require('./token-store');

// 저장된 refresh_token으로 "지금 바로 쓸 수 있는" access_token을 돌려준다.
// 아직 유효하면 그대로, 만료(또는 만료 임박)면 자동으로 refresh해서 저장 후 반환.
async function getValidAccessToken(settingsRepo) {
  const { refreshToken, accessToken, accessTokenExpiry } = tokenStore.getTokens(settingsRepo);
  if (!refreshToken) throw new Error('Google Calendar가 연결되어 있지 않아요.');

  const stillValid =
    accessToken && accessTokenExpiry && new Date(accessTokenExpiry).getTime() - Date.now() > 60 * 1000; // 1분 여유

  if (stillValid) return accessToken;

  const credentials = loadCredentials();
  if (!credentials) throw new Error('config/google-credentials.json 파일을 찾을 수 없어요.');

  const refreshed = await refreshAccessToken(credentials, refreshToken);
  tokenStore.saveTokens(settingsRepo, {
    accessToken: refreshed.access_token,
    expiresIn: refreshed.expires_in,
  });
  return refreshed.access_token;
}

module.exports = { getValidAccessToken };
