const config = require('./app.json').expo;
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
module.exports = () => {
  const local = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
  const preview = local || process.env.EXPO_PUBLIC_PREVIEW_BUILD === 'true';
  const packageName = preview ? 'cn.huiliyi.study.preview' : config.android.package;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '';
  const supplied = process.env.EXPO_ANDROID_GOOGLE_SERVICES_FILE || '';
  const pushRequested = process.env.EXPO_PUBLIC_REMOTE_PUSH_ENABLED === 'true';
  let googleServicesFile;
  if (pushRequested) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ||
      !supplied
    )
      throw new Error(
        'Remote push requires an EAS project ID and private Android Firebase configuration file',
      );
    googleServicesFile = resolve(__dirname, supplied);
    if (!existsSync(googleServicesFile))
      throw new Error('Android Firebase configuration file is unavailable');
    let value;
    try {
      value = JSON.parse(readFileSync(googleServicesFile, 'utf8'));
    } catch {
      throw new Error('Android Firebase configuration file is invalid');
    }
    if (!value.client?.some((c) => c.client_info?.android_client_info?.package_name === packageName))
      throw new Error('Android Firebase configuration does not match this build package');
  }
  return {
    ...config,
    name: preview ? '知学预览' : config.name,
    android: {
      ...config.android,
      package: packageName,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...config.extra,
      remotePushConfigured: !!googleServicesFile,
      ...(googleServicesFile ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
    plugins: config.plugins.map((p) =>
      Array.isArray(p) && p[0] === 'expo-build-properties'
        ? [p[0], { android: { usesCleartextTraffic: local } }]
        : p,
    ),
  };
};
