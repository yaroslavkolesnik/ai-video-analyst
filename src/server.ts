/**
 * Module 6b - the local server.
 *
 * Static files plus one endpoint that runs the pipeline and streams its progress
 * back as it happens. Progress is not decoration: a run takes the better part of
 * a minute, and a page that sits blank for that long is indistinguishable from a
 * page that is lying to you about the work it is doing.
 *
 * Deliberately a plain Node server rather than serverless functions - a single
 * request here runs for 30-60 seconds, which is past what those platforms allow.
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';

import { INGESTION_LIMITS, IngestionError } from './modules/ingestion.js';
import { createGeminiClient, MissingApiKeyError } from './modules/gemini.js';
import { renderGuideMarkdown } from './modules/markdown.js';
import { runPipeline, type PipelineEvent } from './pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const publicDir = resolve(projectRoot, 'public');
const uploadDir = resolve(projectRoot, '.tmp/uploads');

const PORT = Number(process.env['PORT'] ?? 3000);

function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveHash(hash.digest('hex')))
      .on('error', rejectHash);
  });
}

await mkdir(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, done) => {
      const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      done(null, `${stamp}-${file.originalname.replace(/[^\w.-]+/g, '_')}`);
    },
  }),
  limits: { fileSize: INGESTION_LIMITS.maxSizeBytes },
});

const app = express();

app.use(express.static(publicDir, { index: 'index.html' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, limits: INGESTION_LIMITS });
});

app.post('/api/process', upload.single('video'), async (req, res) => {
  const file = req.file;
  if (file === undefined) {
    res.status(422).json({ error: 'no_file', message: 'Attach a recording as the "video" field.' });
    return;
  }

  // The stream starts before any work does, so the page has something to show
  // from the first moment rather than after the first stage finishes.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const ai = createGeminiClient();
    const runId = `run-${Date.now().toString(36)}`;

    const result = await runPipeline(
      ai,
      {
        videoPath: file.path,
        framesRoot: resolve(publicDir, 'frames'),
        sha256: await sha256(file.path),
        deleteSourceWhenDone: true,
      },
      (event: PipelineEvent) => send({ ...event, runId }),
    );

    send({
      type: 'done',
      document: result.document,
      markdown: renderGuideMarkdown(result.document, { imageBasePath: '' }),
      metrics: result.metrics,
    });
  } catch (error) {
    // Anything the user could fix by uploading a different file is named as such;
    // everything else says so plainly instead of pretending the run succeeded.
    const code =
      error instanceof IngestionError
        ? error.code
        : error instanceof MissingApiKeyError
          ? 'missing_api_key'
          : 'pipeline_failed';

    send({
      type: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    await rm(file.path, { force: true });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Screencast → How-To: http://localhost:${PORT}/`);
  console.log(`Serving: ${publicDir}`);
});
