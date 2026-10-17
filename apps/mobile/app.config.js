const config = require('./app.json').expo;
module.exports = () => {
  const local = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
  const preview = local || process.env.EXPO_PUBLIC_PREVIEW_BUILD === 'true';
  return { ...config, name: preview ? '知学预览' : config.name,
    android: { ...config.android, package: preview ? 'cn.huiliyi.study.preview' : config.android.package },
    plugins: config.plugins.map(p => Array.isArray(p) && p[0] === 'expo-build-properties'
      ? [p[0], { android: { usesCleartextTraffic: local } }] : p),
  };
};
