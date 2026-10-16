import { createRequire } from 'node:module';
import { RoomServiceClient } from 'livekit-server-sdk';
const require = createRequire(import.meta.url);
try {
  const { readLiveConfiguration } = require('../apps/api/dist/live/live.config.js');
  const c = readLiveConfiguration();
  await new RoomServiceClient(c.serverUrl, c.apiKey, c.apiSecret, {
    requestTimeout: 5,
    failover: false,
  }).listRooms();
  console.log('PASS LiveKit configuration, connection and server authentication');
  console.log('Media connectivity still requires the documented two-client browser check.');
} catch {
  console.error(
    'FAIL LiveKit connection check failed; inspect media service, network and credentials. No credentials or upstream logs were printed.',
  );
  process.exitCode = 1;
}
