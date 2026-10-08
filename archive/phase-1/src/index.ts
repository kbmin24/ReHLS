import { createApp } from './app.js';
import { createPublicClient } from './public-fetch.js';

const port = Number(process.env.PORT ?? 3000);
const server = createApp({ upstream: createPublicClient() }).listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    process.stdout.write(`ReHLS: http://127.0.0.1:${address.port}\n`);
  }
});
