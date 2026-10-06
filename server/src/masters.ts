// マスタ（利用者・車両・運転者・車両区分・設定）の CRUD API
import { Router } from 'express';
import { z } from 'zod';
import { exec, rows, tx, type Conn } from './db.ts';
import { HttpError } from './errors.ts';

export const masters = Router();

const id = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID が不正です');
  return n;
};

const notFound = <T>(r: T | undefined): T => {
  if (r === undefined) throw new HttpError(404, '見つかりません');
  return r;
};

const str = (max: number) => z.string().trim().max(max);
const required = (max: number, label: string) => str(max).min(1, `${label}を入力してください`);
const coord = z.number().min(-180).max(180).nullable();
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, '時刻は HH:MM で入力してください');

// ---------- 車両区分（車の大きさ） ----------

const classBody = z.object({ name: required(50, '区分名'), sortOrder: z.number().int().default(0) });

masters.get('/vehicle-classes', async (_req, res) => {
  res.json(await rows('SELECT id, name, sort_order AS sortOrder FROM vehicle_classes ORDER BY sort_order, id'));
});

masters.post('/vehicle-classes', async (req, res) => {
  const b = classBody.parse(req.body);
  const r = await exec('INSERT INTO vehicle_classes (name, sort_order) VALUES (?, ?)', [b.name, b.sortOrder]);
  res.status(201).json({ id: r.insertId });
});

masters.put('/vehicle-classes/:id', async (req, res) => {
  const b = classBody.parse(req.body);
  const r = await exec('UPDATE vehicle_classes SET name = ?, sort_order = ? WHERE id = ?', [b.name, b.sortOrder, id(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, '見つかりません');
  res.json({ ok: true });
});

masters.delete('/vehicle-classes/:id', async (req, res) => {
  await exec('DELETE FROM vehicle_classes WHERE id = ?', [id(req.params.id)]);
  res.json({ ok: true });
});

// ---------- 利用者 ----------

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const clientBody = z.object({
  code: required(20, '管理番号'),
  name: required(50, '名前'),
  kana: str(50).default(''),
  adl: z.enum(['自立', '見守り', '一部介助', '全介助']),
  wheelchair: z.boolean(),
  address: str(255).default(''),
  lat: coord.default(null),
  lng: coord.default(null),
  days: z.array(z.enum(DAYS)).default([]),
  active: z.boolean().default(true),
  note: str(255).default(''),
});

const CLIENT_COLS = 'id, code, name, kana, adl, wheelchair, address, lat, lng, days, active, note';
type ClientRow = z.infer<typeof clientBody> & { id: number; days: string | string[] };
const clientOut = (r: ClientRow) => ({ ...r, days: typeof r.days === 'string' ? r.days.split(',').filter(Boolean) : r.days });

masters.get('/clients', async (_req, res) => {
  const list = await rows<ClientRow>(`SELECT ${CLIENT_COLS} FROM clients ORDER BY active DESC, code`);
  res.json(list.map(clientOut));
});

masters.get('/clients/:id', async (req, res) => {
  const [r] = await rows<ClientRow>(`SELECT ${CLIENT_COLS} FROM clients WHERE id = ?`, [id(req.params.id)]);
  res.json(clientOut(notFound(r)));
});

const clientParams = (b: z.infer<typeof clientBody>) => [
  b.code, b.name, b.kana, b.adl, b.wheelchair, b.address, b.lat, b.lng, b.days.join(','), b.active, b.note,
];

masters.post('/clients', async (req, res) => {
  const b = clientBody.parse(req.body);
  const r = await exec(
    'INSERT INTO clients (code, name, kana, adl, wheelchair, address, lat, lng, days, active, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    clientParams(b),
  );
  res.status(201).json({ id: r.insertId });
});

masters.put('/clients/:id', async (req, res) => {
  const b = clientBody.parse(req.body);
  const r = await exec(
    'UPDATE clients SET code=?, name=?, kana=?, adl=?, wheelchair=?, address=?, lat=?, lng=?, days=?, active=?, note=? WHERE id=?',
    [...clientParams(b), id(req.params.id)],
  );
  if (!r.affectedRows) throw new HttpError(404, '見つかりません');
  res.json({ ok: true });
});

masters.delete('/clients/:id', async (req, res) => {
  await exec('DELETE FROM clients WHERE id = ?', [id(req.params.id)]);
  res.json({ ok: true });
});

// ---------- 車両 ----------

const vehicleBody = z
  .object({
    name: required(50, '車両名'),
    model: str(100).default(''),
    classId: z.number().int().positive('車の大きさを選んでください'),
    capacity: z.number().int().min(1, '乗車人数は 1 以上').max(30),
    wheelchairCapacity: z.number().int().min(0).max(30),
    active: z.boolean().default(true),
    note: str(255).default(''),
  })
  .refine((v) => v.wheelchairCapacity <= v.capacity, { message: '車椅子数は乗車人数以下にしてください', path: ['wheelchairCapacity'] });

const VEHICLE_SELECT = `SELECT v.id, v.name, v.model, v.class_id AS classId, c.name AS className, v.capacity,
  v.wheelchair_capacity AS wheelchairCapacity, v.active, v.note
  FROM vehicles v JOIN vehicle_classes c ON c.id = v.class_id`;

masters.get('/vehicles', async (_req, res) => {
  res.json(await rows(`${VEHICLE_SELECT} ORDER BY v.active DESC, c.sort_order DESC, v.name`));
});

masters.get('/vehicles/:id', async (req, res) => {
  const [r] = await rows(`${VEHICLE_SELECT} WHERE v.id = ?`, [id(req.params.id)]);
  res.json(notFound(r));
});

const vehicleParams = (b: z.infer<typeof vehicleBody>) => [b.name, b.model, b.classId, b.capacity, b.wheelchairCapacity, b.active, b.note];

masters.post('/vehicles', async (req, res) => {
  const b = vehicleBody.parse(req.body);
  const r = await exec(
    'INSERT INTO vehicles (name, model, class_id, capacity, wheelchair_capacity, active, note) VALUES (?,?,?,?,?,?,?)',
    vehicleParams(b),
  );
  res.status(201).json({ id: r.insertId });
});

masters.put('/vehicles/:id', async (req, res) => {
  const b = vehicleBody.parse(req.body);
  const r = await exec(
    'UPDATE vehicles SET name=?, model=?, class_id=?, capacity=?, wheelchair_capacity=?, active=?, note=? WHERE id=?',
    [...vehicleParams(b), id(req.params.id)],
  );
  if (!r.affectedRows) throw new HttpError(404, '見つかりません');
  res.json({ ok: true });
});

masters.delete('/vehicles/:id', async (req, res) => {
  await exec('DELETE FROM vehicles WHERE id = ?', [id(req.params.id)]);
  res.json({ ok: true });
});

// ---------- 運転者 ----------

const driverBody = z.object({
  name: required(50, '名前'),
  kana: str(50).default(''),
  classIds: z.array(z.number().int().positive()).default([]),
  active: z.boolean().default(true),
  note: str(255).default(''),
});

type DriverRow = { id: number; name: string; kana: string; active: boolean; note: string; classIds: string | null };
const driverOut = (r: DriverRow) => ({ ...r, classIds: r.classIds ? r.classIds.split(',').map(Number) : [] });
const DRIVER_SELECT = `SELECT d.id, d.name, d.kana, d.active, d.note,
  (SELECT GROUP_CONCAT(class_id ORDER BY class_id) FROM driver_vehicle_classes WHERE driver_id = d.id) AS classIds
  FROM drivers d`;

masters.get('/drivers', async (_req, res) => {
  res.json((await rows<DriverRow>(`${DRIVER_SELECT} ORDER BY d.active DESC, d.kana, d.name`)).map(driverOut));
});

masters.get('/drivers/:id', async (req, res) => {
  const [r] = await rows<DriverRow>(`${DRIVER_SELECT} WHERE d.id = ?`, [id(req.params.id)]);
  res.json(driverOut(notFound(r)));
});

async function saveDriverClasses(conn: Conn, driverId: number, classIds: number[]) {
  await exec('DELETE FROM driver_vehicle_classes WHERE driver_id = ?', [driverId], conn);
  if (classIds.length) {
    await exec('INSERT INTO driver_vehicle_classes (driver_id, class_id) VALUES ?', [
      [...new Set(classIds)].map((c) => [driverId, c]),
    ], conn);
  }
}

masters.post('/drivers', async (req, res) => {
  const b = driverBody.parse(req.body);
  const newId = await tx(async (conn) => {
    const r = await exec('INSERT INTO drivers (name, kana, active, note) VALUES (?,?,?,?)', [b.name, b.kana, b.active, b.note], conn);
    await saveDriverClasses(conn, r.insertId, b.classIds);
    return r.insertId;
  });
  res.status(201).json({ id: newId });
});

masters.put('/drivers/:id', async (req, res) => {
  const b = driverBody.parse(req.body);
  const driverId = id(req.params.id);
  await tx(async (conn) => {
    const r = await exec('UPDATE drivers SET name=?, kana=?, active=?, note=? WHERE id=?', [b.name, b.kana, b.active, b.note, driverId], conn);
    if (!r.affectedRows) throw new HttpError(404, '見つかりません');
    await saveDriverClasses(conn, driverId, b.classIds);
  });
  res.json({ ok: true });
});

masters.delete('/drivers/:id', async (req, res) => {
  await exec('DELETE FROM drivers WHERE id = ?', [id(req.params.id)]);
  res.json({ ok: true });
});

// ---------- 設定 ----------

const settingsBody = z.object({
  facilityName: str(100),
  facilityAddress: str(255),
  facilityLat: coord,
  facilityLng: coord,
  avgSpeedKmh: z.number().min(5).max(80),
  stopMinutes: z.number().int().min(0).max(60),
  wheelchairMinutes: z.number().int().min(0).max(60),
  pickupArriveTime: time,
  dropoffDepartTime: time,
});
export type Settings = z.infer<typeof settingsBody>;

export async function loadSettings(): Promise<Settings> {
  const [s] = await rows<Settings>(`SELECT facility_name AS facilityName, facility_address AS facilityAddress,
    facility_lat AS facilityLat, facility_lng AS facilityLng, avg_speed_kmh AS avgSpeedKmh,
    stop_minutes AS stopMinutes, wheelchair_minutes AS wheelchairMinutes,
    pickup_arrive_time AS pickupArriveTime, dropoff_depart_time AS dropoffDepartTime FROM settings WHERE id = 1`);
  return s;
}

masters.get('/settings', async (_req, res) => {
  res.json(await loadSettings());
});

masters.put('/settings', async (req, res) => {
  const b = settingsBody.parse(req.body);
  await exec(
    `UPDATE settings SET facility_name=?, facility_address=?, facility_lat=?, facility_lng=?, avg_speed_kmh=?,
     stop_minutes=?, wheelchair_minutes=?, pickup_arrive_time=?, dropoff_depart_time=? WHERE id = 1`,
    [b.facilityName, b.facilityAddress, b.facilityLat, b.facilityLng, b.avgSpeedKmh, b.stopMinutes,
      b.wheelchairMinutes, b.pickupArriveTime, b.dropoffDepartTime],
  );
  res.json({ ok: true });
});

// ---------- 住所検索（国土地理院 住所検索 API） ----------

type GsiResult = { geometry: { coordinates: [number, number] }; properties: { title: string } };

masters.get('/geocode', async (req, res) => {
  const q = z.string().trim().min(1, '住所を入力してください').max(200).parse(req.query.q);
  const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) throw new HttpError(502, '住所検索サービスに接続できませんでした');
  const data = (await r.json()) as GsiResult[];
  res.json(
    data.slice(0, 5).map((d) => ({ title: d.properties.title, lat: d.geometry.coordinates[1], lng: d.geometry.coordinates[0] })),
  );
});
