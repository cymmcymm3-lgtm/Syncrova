const readFirstEnv = (keys = []) => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return { key, value };
  }
  return { key: keys[0] || '', value: '' };
};

const normalizeLiveKitUrl = (value = '') => {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return { value: '', warning: '' };
  if (/^wss?:\/\//i.test(raw)) return { value: raw, warning: '' };
  if (/^https:\/\//i.test(raw)) {
    return {
      value: raw.replace(/^https:\/\//i, 'wss://'),
      warning: 'LIVEKIT_URL was converted from https:// to wss:// for WebRTC signaling.'
    };
  }
  if (/^http:\/\//i.test(raw)) {
    return {
      value: raw.replace(/^http:\/\//i, 'ws://'),
      warning: 'LIVEKIT_URL was converted from http:// to ws:// for local WebRTC signaling.'
    };
  }
  return {
    value: `wss://${raw}`,
    warning: 'LIVEKIT_URL did not include a scheme, so wss:// was assumed.'
  };
};

const livekitEnvKeys = {
  url: ['LIVEKIT_URL', 'LIVEKIT_WS_URL', 'LIVEKIT_CLOUD_URL', 'VITE_LIVEKIT_URL'],
  apiKey: ['LIVEKIT_API_KEY', 'LIVEKIT_KEY', 'LIVEKIT_APIKEY'],
  apiSecret: ['LIVEKIT_API_SECRET', 'LIVEKIT_SECRET', 'LIVEKIT_API_SECRET_KEY']
};

const getLiveKitConfig = () => {
  const url = readFirstEnv(livekitEnvKeys.url);
  const apiKey = readFirstEnv(livekitEnvKeys.apiKey);
  const apiSecret = readFirstEnv(livekitEnvKeys.apiSecret);
  const normalizedUrl = normalizeLiveKitUrl(url.value);

  const missing = [
    !normalizedUrl.value && 'LIVEKIT_URL',
    !apiKey.value && 'LIVEKIT_API_KEY',
    !apiSecret.value && 'LIVEKIT_API_SECRET'
  ].filter(Boolean);

  return {
    livekitUrl: normalizedUrl.value,
    apiKey: apiKey.value,
    apiSecret: apiSecret.value,
    configured: missing.length === 0,
    missing,
    warnings: [normalizedUrl.warning].filter(Boolean),
    sourceKeys: {
      url: url.value ? url.key : '',
      apiKey: apiKey.value ? apiKey.key : '',
      apiSecret: apiSecret.value ? apiSecret.key : ''
    }
  };
};

const getLiveKitStatus = () => {
  const config = getLiveKitConfig();
  return {
    livekitConfigured: config.configured,
    livekitMissing: config.missing,
    livekitWarnings: config.warnings,
    livekitSourceKeys: config.sourceKeys
  };
};

module.exports = {
  getLiveKitConfig,
  getLiveKitStatus
};
