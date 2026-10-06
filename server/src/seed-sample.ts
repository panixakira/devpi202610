// 動作確認用の架空データを投入する（利用者が 0 件のときだけ）
// 使い方: npm run seed:sample -w server
import { exec, pool, rows } from './db.ts';

const base = { lat: 35.6689, lng: 139.4778 }; // 施設（仮）

const [{ n }] = await rows<{ n: number }>('SELECT COUNT(*) AS n FROM clients');
if (n > 0) {
  console.log('利用者がすでに登録されているため、サンプル投入はスキップしました');
  await pool.end();
  process.exit(0);
}

await exec(
  `UPDATE settings SET facility_name = 'サンプルデイサービス', facility_address = 'サンプル住所', facility_lat = ?, facility_lng = ? WHERE id = 1`,
  [base.lat, base.lng],
);

const classes = new Map((await rows<{ id: number; name: string }>('SELECT id, name FROM vehicle_classes')).map((c) => [c.name, c.id]));
const vehicles: [string, string, string, number, number][] = [
  ['ハイエース1号', 'トヨタ ハイエース 福祉車両', 'ワゴン・ハイエース', 8, 2],
  ['ハイエース2号', 'トヨタ ハイエース 福祉車両', 'ワゴン・ハイエース', 8, 2],
  ['セレナ', '日産 セレナ', '普通車', 6, 0],
  ['シエンタ', 'トヨタ シエンタ ウェルキャブ', '普通車', 4, 1],
  ['N-BOX', 'ホンダ N-BOX スロープ', '軽自動車', 2, 1],
];
for (const [name, model, cls, cap, wc] of vehicles) {
  await exec('INSERT INTO vehicles (name, model, class_id, capacity, wheelchair_capacity) VALUES (?,?,?,?,?)', [name, model, classes.get(cls), cap, wc]);
}

const drivers: [string, string[]][] = [
  ['運転 一郎', ['軽自動車', '普通車', 'ワゴン・ハイエース']],
  ['運転 二郎', ['軽自動車', '普通車', 'ワゴン・ハイエース']],
  ['運転 三子', ['軽自動車', '普通車']],
  ['運転 四郎', ['軽自動車']],
];
for (const [name, cls] of drivers) {
  const r = await exec('INSERT INTO drivers (name) VALUES (?)', [name]);
  for (const c of cls) await exec('INSERT INTO driver_vehicle_classes VALUES (?, ?)', [r.insertId, classes.get(c)]);
}

const adls = ['自立', '見守り', '一部介助', '全介助'];
const dayPatterns = ['mon,wed,fri', 'tue,thu,sat', 'mon,tue,wed,thu,fri', 'mon,thu'];
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 1; i <= 30; i++) {
  const a = rand() * 2 * Math.PI;
  const r = 0.005 + rand() * 0.035; // 約 0.5〜4km
  await exec(
    'INSERT INTO clients (code, name, kana, adl, wheelchair, address, lat, lng, days) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      `S${String(i).padStart(3, '0')}`,
      `サンプル 利用者${i}`,
      `サンプル リヨウシャ${i}`,
      adls[i % 4],
      i % 6 === 0,
      `サンプル住所 ${i}`,
      (base.lat + r * Math.sin(a)).toFixed(6),
      (base.lng + r * Math.cos(a) * 1.2).toFixed(6),
      dayPatterns[i % 4],
    ],
  );
}
console.log('サンプルデータを投入しました（車両 5 / 運転者 4 / 利用者 30）');
await pool.end();
