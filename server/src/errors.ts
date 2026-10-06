import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// MariaDB のエラー番号
const ER_DUP_ENTRY = 1062;
const ER_ROW_IS_REFERENCED = 1451;
const ER_NO_REFERENCED_ROW = 1452;

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map((i) => i.message).join('\n') });
  } else if (err?.errno === ER_DUP_ENTRY) {
    res.status(409).json({ error: '同じ値がすでに登録されています（管理番号・名前などの重複）' });
  } else if (err?.errno === ER_ROW_IS_REFERENCED) {
    res.status(409).json({ error: '運行記録や他のデータで使われているため削除できません。「利用中」を外して無効にしてください' });
  } else if (err?.errno === ER_NO_REFERENCED_ROW) {
    res.status(400).json({ error: '参照先のデータが存在しません' });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'リクエストの形式が不正です' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
};
