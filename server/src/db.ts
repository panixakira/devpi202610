import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  database: process.env.DB_NAME ?? 'devpi',
  user: process.env.DB_USER ?? 'devpi',
  password: process.env.DB_PASS ?? '',
  charset: 'utf8mb4',
  connectionLimit: 5,
  decimalNumbers: true,
  dateStrings: true,
  // BOOLEAN(TINYINT(1)) を true/false で返す
  typeCast(field, next) {
    if (field.type === 'TINY' && field.length === 1) {
      const v = field.string();
      return v === null ? null : v === '1';
    }
    return next();
  },
});

export type Row = mysql.RowDataPacket;
export type Conn = mysql.PoolConnection;

export async function rows<T>(sql: string, params: unknown[] = [], conn: Pick<Conn, 'query'> = pool): Promise<T[]> {
  const [r] = await conn.query<Row[]>(sql, params);
  return r as T[];
}

export async function exec(sql: string, params: unknown[] = [], conn: Pick<Conn, 'query'> = pool) {
  const [r] = await conn.query<mysql.ResultSetHeader>(sql, params);
  return r;
}

export async function tx<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
