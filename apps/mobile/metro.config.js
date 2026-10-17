const { getDefaultConfig } = require('expo/metro-config');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const config = getDefaultConfig(__dirname);
// Expo's embedded CI build retains Metro transforms between local/HTTPS profiles.
// Include both profile values and our dependency patches in the transform key.
config.cacheVersion = createHash('sha256')
  .update(JSON.stringify([
    process.env.EXPO_PUBLIC_API_ORIGIN || '',
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP || '',
    process.env.EXPO_PUBLIC_PREVIEW_BUILD || '',
  ]))
  .update(readFileSync(join(__dirname, 'patches/build-hardening.json')))
  .digest('hex');
module.exports = config;
