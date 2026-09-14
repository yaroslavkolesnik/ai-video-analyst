/**
 * Serves the demo fixture over HTTP so the test recordings show a real
 * browser app at localhost rather than a file:// path.
 *
 *   npm run demo-app   ->   http://localhost:4173/
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const demoAppDir = resolve(here, '../fixtures/demo-app');

const PORT = Number(process.env['DEMO_APP_PORT'] ?? 4173);

const app = express();

app.use(express.static(demoAppDir, { extensions: ['html'], index: 'orders.html' }));

app.listen(PORT, () => {
  console.log(`Demo app: http://localhost:${PORT}/`);
  console.log(`Serving:  ${demoAppDir}`);
});
