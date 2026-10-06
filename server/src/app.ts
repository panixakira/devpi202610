import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errorHandler, HttpError } from './errors.ts';
import { masters } from './masters.ts';
import { plans } from './plans.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', masters);
  app.use('/api/plans', plans);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API が見つかりません')));

  // ビルド済みフロントエンドを配信（SPA なので未知のパスは index.html へ）
  const dist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
  }

  app.use(errorHandler);
  return app;
}
