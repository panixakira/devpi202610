import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
createApp().listen(port, host, () => {
  console.log(`送迎管理 API: http://${host}:${port}`);
});
