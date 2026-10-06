// 運行計画（ルート生成・手動調整・実績記録）の API
import { Router } from 'express';
import { z } from 'zod';
import { exec, rows, tx, type Conn } from './db.ts';
import { HttpError } from './errors.ts';
import { loadSettings, type Settings } from './masters.ts';
import { generatePlan, scheduleRun, type Direction, type LatLng } from './routing.ts';

export const plans = Router();

const id = (v: unknown) => z.coerce.number().int().positive('ID が不正です').parse(v);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付が不正です');
const direction = z.enum(['pickup', 'dropoff']);
const optTime = z
  .string()
  .regex(/^(\d{2}:\d{2}(:\d{2})?)?$/, '時刻は HH:MM で入力してください')
  .nullable()
  .transform((t) => (t ? t : null));

const DIRECTION_LABEL: Record<Direction, string> = { pickup: '迎え', dropoff: '送り' };

function facilityOf(s: Settings): LatLng {
  if (s.facilityLat == null || s.facilityLng == null) {
    throw new HttpError(400, '「設定」で施設の位置を登録してください');
  }
  return { lat: s.facilityLat, lng: s.facilityLng };
}

// ---------- 参照データ ----------

type ClientInfo = { id: number; code: string; name: string; wheelchair: boolean; lat: number | null; lng: number | null; active: boolean };
type VehicleInfo = { id: number; name: string; classId: number; className: string; capacity: number; wheelchairCapacity: number };
type DriverInfo = { id: number; name: string; classIds: number[] };

async function loadClients(ids: number[], conn: Conn): Promise<Map<number, ClientInfo>> {
  if (!ids.length) return new Map();
  const list = await rows<ClientInfo>('SELECT id, code, name, wheelchair, lat, lng, active FROM clients WHERE id IN (?)', [ids], conn);
  return new Map(list.map((c) => [c.id, c]));
}

async function loadVehicles(ids: number[], conn: Conn): Promise<Map<number, VehicleInfo>> {
  if (!ids.length) return new Map();
  const list = await rows<VehicleInfo>(
    `SELECT v.id, v.name, v.class_id AS classId, c.name AS className, v.capacity, v.wheelchair_capacity AS wheelchairCapacity
     FROM vehicles v JOIN vehicle_classes c ON c.id = v.class_id WHERE v.id IN (?)`,
    [ids],
    conn,
  );
  return new Map(list.map((v) => [v.id, v]));
}

async function loadDrivers(ids: number[], conn: Conn): Promise<Map<number, DriverInfo>> {
  if (!ids.length) return new Map();
  const list = await rows<{ id: number; name: string; classIds: string | null }>(
    `SELECT d.id, d.name, GROUP_CONCAT(dvc.class_id) AS classIds
     FROM drivers d LEFT JOIN driver_vehicle_classes dvc ON dvc.driver_id = d.id
     WHERE d.id IN (?) GROUP BY d.id`,
    [ids],
    conn,
  );
  return new Map(list.map((d) => [d.id, { ...d, classIds: d.classIds ? d.classIds.split(',').map(Number) : [] }]));
}

function requireAll<T>(map: Map<number, T>, ids: number[], label: string) {
  const missing = ids.filter((i) => !map.has(i));
  if (missing.length) throw new HttpError(400, `存在しない${label}が含まれています (ID: ${missing.join(', ')})`);
}

// ---------- 一覧・詳細 ----------

plans.get('/', async (req, res) => {
  const from = date.optional().parse(req.query.from || undefined);
  const to = date.optional().parse(req.query.to || undefined);
  const where: string[] = [];
  const params: unknown[] = [];
  if (from) (where.push('p.service_date >= ?'), params.push(from));
  if (to) (where.push('p.service_date <= ?'), params.push(to));
  res.json(
    await rows(
      `SELECT p.id, p.service_date AS serviceDate, p.direction, p.status, p.note, p.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM route_runs r WHERE r.plan_id = p.id) AS runCount,
         (SELECT COUNT(*) FROM route_stops s WHERE s.plan_id = p.id AND s.run_id IS NOT NULL) AS assignedCount,
         (SELECT COUNT(*) FROM route_stops s WHERE s.plan_id = p.id AND s.run_id IS NULL) AS unassignedCount
       FROM route_plans p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.service_date DESC, p.direction DESC LIMIT 200`,
      params,
    ),
  );
});

async function planDetail(planId: number) {
  const [plan] = await rows<Record<string, unknown>>(
    `SELECT id, service_date AS serviceDate, direction, status, note, updated_at AS updatedAt FROM route_plans WHERE id = ?`,
    [planId],
  );
  if (!plan) throw new HttpError(404, '運行計画が見つかりません');
  const runs = await rows<{ id: number } & Record<string, unknown>>(
    `SELECT r.id, r.vehicle_id AS vehicleId, v.name AS vehicleName, v.model AS vehicleModel, c.name AS className,
       v.capacity, v.wheelchair_capacity AS wheelchairCapacity, r.driver_id AS driverId, d.name AS driverName,
       r.sort_order AS sortOrder, r.depart_time AS departTime, r.return_time AS returnTime, r.distance_km AS distanceKm,
       r.actual_depart_time AS actualDepartTime, r.actual_return_time AS actualReturnTime, r.note
     FROM route_runs r JOIN vehicles v ON v.id = r.vehicle_id JOIN vehicle_classes c ON c.id = v.class_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     WHERE r.plan_id = ? ORDER BY r.sort_order, r.id`,
    [planId],
  );
  const stops = await rows<{ runId: number | null } & Record<string, unknown>>(
    `SELECT s.id, s.run_id AS runId, s.client_id AS clientId, cl.code, cl.name, cl.adl, cl.wheelchair, cl.address,
       cl.lat, cl.lng, s.seq, s.planned_time AS plannedTime, s.actual_time AS actualTime, s.status,
       s.unassigned_reason AS unassignedReason, s.note
     FROM route_stops s JOIN clients cl ON cl.id = s.client_id
     WHERE s.plan_id = ? ORDER BY s.seq, cl.code`,
    [planId],
  );
  const settings = await loadSettings();
  return {
    ...plan,
    facility: { name: settings.facilityName, lat: settings.facilityLat, lng: settings.facilityLng },
    runs: runs.map((r) => ({ ...r, stops: stops.filter((s) => s.runId === r.id) })),
    unassigned: stops.filter((s) => s.runId === null),
  };
}

plans.get('/:id', async (req, res) => {
  res.json(await planDetail(id(req.params.id)));
});

// ---------- 自動生成 ----------

const generateBody = z.object({
  serviceDate: date,
  direction,
  clientIds: z.array(z.number().int().positive()).min(1, '利用者を 1 人以上選んでください'),
  vehicleIds: z.array(z.number().int().positive()).min(1, '車両を 1 台以上選んでください'),
  driverIds: z.array(z.number().int().positive()).min(1, '運転者を 1 人以上選んでください'),
  replace: z.boolean().default(false),
});

plans.post('/generate', async (req, res) => {
  const b = generateBody.parse(req.body);
  const settings = await loadSettings();
  const depot = facilityOf(settings);

  const planId = await tx(async (conn) => {
    const [existing] = await rows<{ id: number }>(
      'SELECT id FROM route_plans WHERE service_date = ? AND direction = ? FOR UPDATE',
      [b.serviceDate, b.direction],
      conn,
    );
    if (existing && !b.replace) {
      throw new HttpError(409, `${b.serviceDate} の${DIRECTION_LABEL[b.direction]}はすでに作成済みです`);
    }
    if (existing) await exec('DELETE FROM route_plans WHERE id = ?', [existing.id], conn);

    const clients = await loadClients(b.clientIds, conn);
    const vehicles = await loadVehicles(b.vehicleIds, conn);
    const drivers = await loadDrivers(b.driverIds, conn);
    requireAll(clients, b.clientIds, '利用者');
    requireAll(vehicles, b.vehicleIds, '車両');
    requireAll(drivers, b.driverIds, '運転者');

    const result = generatePlan(depot, [...clients.values()], [...vehicles.values()], [...drivers.values()], settings, b.direction);

    const plan = await exec('INSERT INTO route_plans (service_date, direction) VALUES (?, ?)', [b.serviceDate, b.direction], conn);
    for (const [i, run] of result.runs.entries()) {
      const r = await exec(
        `INSERT INTO route_runs (plan_id, vehicle_id, driver_id, sort_order, depart_time, return_time, distance_km)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [plan.insertId, run.vehicleId, run.driverId, i, run.departTime, run.returnTime, run.distanceKm],
        conn,
      );
      for (const [seq, clientId] of run.clientIds.entries()) {
        await exec(
          'INSERT INTO route_stops (plan_id, run_id, client_id, seq, planned_time) VALUES (?, ?, ?, ?, ?)',
          [plan.insertId, r.insertId, clientId, seq, run.plannedTimes[seq]],
          conn,
        );
      }
    }
    for (const u of result.unassigned) {
      await exec('INSERT INTO route_stops (plan_id, client_id, unassigned_reason) VALUES (?, ?, ?)', [plan.insertId, u.clientId, u.reason], conn);
    }
    return plan.insertId;
  });

  res.status(201).json({ id: planId });
});

// ---------- 手動調整（車両・運転者・乗車順の変更） ----------

const layoutBody = z.object({
  runs: z.array(
    z.object({
      id: z.number().int().positive().nullable().default(null),
      vehicleId: z.number().int().positive(),
      driverId: z.number().int().positive().nullable(),
      clientIds: z.array(z.number().int().positive()),
    }),
  ),
  unassignedClientIds: z.array(z.number().int().positive()).default([]),
});
type Layout = z.infer<typeof layoutBody>;

/** 手動調整した内容が安全に運行できるか検査し、問題点を返す */
export function validateLayout(
  layout: Layout,
  vehicles: Map<number, VehicleInfo>,
  drivers: Map<number, DriverInfo>,
  clients: Map<number, { wheelchair: boolean; name: string }>,
): string[] {
  const errors: string[] = [];
  const seen = <K>(label: string, values: K[], name: (v: K) => string) => {
    const dup = values.filter((v, i) => values.indexOf(v) !== i);
    for (const v of new Set(dup)) errors.push(`${name(v)} が複数の${label}に入っています`);
  };
  seen('便', layout.runs.map((r) => r.vehicleId), (v) => `車両「${vehicles.get(v)?.name}」`);
  seen('便', layout.runs.flatMap((r) => (r.driverId ? [r.driverId] : [])), (d) => `運転者「${drivers.get(d)?.name}」`);
  seen('便（または未割当）', [...layout.runs.flatMap((r) => r.clientIds), ...layout.unassignedClientIds], (c) => `利用者「${clients.get(c)?.name}」`);

  for (const run of layout.runs) {
    const v = vehicles.get(run.vehicleId)!;
    const wc = run.clientIds.filter((c) => clients.get(c)?.wheelchair).length;
    if (run.clientIds.length > v.capacity) errors.push(`「${v.name}」の定員 ${v.capacity} 人を超えています（${run.clientIds.length} 人）`);
    if (wc > v.wheelchairCapacity) errors.push(`「${v.name}」の車椅子枠 ${v.wheelchairCapacity} 台を超えています（${wc} 台）`);
    if (run.driverId) {
      const d = drivers.get(run.driverId)!;
      if (!d.classIds.includes(v.classId)) errors.push(`運転者「${d.name}」は「${v.className}」（${v.name}）を運転できません`);
    } else if (run.clientIds.length) {
      errors.push(`「${v.name}」に運転者が設定されていません`);
    }
  }
  return errors;
}

plans.put('/:id/layout', async (req, res) => {
  const planId = id(req.params.id);
  const b = layoutBody.parse(req.body);
  const settings = await loadSettings();
  const depot = facilityOf(settings);

  await tx(async (conn) => {
    const [plan] = await rows<{ direction: Direction }>('SELECT direction FROM route_plans WHERE id = ? FOR UPDATE', [planId], conn);
    if (!plan) throw new HttpError(404, '運行計画が見つかりません');

    const clientIds = [...b.runs.flatMap((r) => r.clientIds), ...b.unassignedClientIds];
    const vehicleIds = b.runs.map((r) => r.vehicleId);
    const driverIds = b.runs.flatMap((r) => (r.driverId ? [r.driverId] : []));
    const [clients, vehicles, drivers] = [
      await loadClients(clientIds, conn),
      await loadVehicles(vehicleIds, conn),
      await loadDrivers(driverIds, conn),
    ];
    requireAll(clients, clientIds, '利用者');
    requireAll(vehicles, vehicleIds, '車両');
    requireAll(drivers, driverIds, '運転者');

    const errors = validateLayout(b, vehicles, drivers, clients);
    if (errors.length) throw new HttpError(400, errors.join('\n'));

    const existingRuns = new Set((await rows<{ id: number }>('SELECT id FROM route_runs WHERE plan_id = ?', [planId], conn)).map((r) => r.id));
    const foreign = b.runs.filter((r) => r.id && !existingRuns.has(r.id));
    if (foreign.length) throw new HttpError(400, '別の運行計画の便が含まれています');

    // 送信されなかった便は削除（立ち寄りは FK で未割当になり、下で再設定する）
    const keepIds = b.runs.flatMap((r) => (r.id ? [r.id] : []));
    await exec(`DELETE FROM route_runs WHERE plan_id = ? ${keepIds.length ? 'AND id NOT IN (?)' : ''}`, [planId, keepIds], conn);

    const existingStops = new Set(
      (await rows<{ clientId: number }>('SELECT client_id AS clientId FROM route_stops WHERE plan_id = ?', [planId], conn)).map((s) => s.clientId),
    );
    const upsertStop = async (clientId: number, runId: number | null, seq: number, plannedTime: string | null) => {
      if (existingStops.has(clientId)) {
        await exec(
          // SET は左から評価されるので、旧 run_id を参照する unassigned_reason を先に更新する
          `UPDATE route_stops SET
             unassigned_reason = IF(? IS NULL, IF(run_id IS NULL, unassigned_reason, '手動で未割当'), ''),
             run_id = ?, seq = ?, planned_time = ?
           WHERE plan_id = ? AND client_id = ?`,
          [runId, runId, seq, plannedTime, planId, clientId],
          conn,
        );
      } else {
        await exec(
          'INSERT INTO route_stops (plan_id, run_id, client_id, seq, planned_time, unassigned_reason) VALUES (?, ?, ?, ?, ?, ?)',
          [planId, runId, clientId, seq, plannedTime, runId ? '' : '手動で追加'],
          conn,
        );
      }
    };

    for (const [i, run] of b.runs.entries()) {
      const sched = scheduleRun(depot, run.clientIds.map((c) => clients.get(c)!), settings, plan.direction);
      let runId = run.id;
      if (runId) {
        await exec(
          'UPDATE route_runs SET vehicle_id = ?, driver_id = ?, sort_order = ?, depart_time = ?, return_time = ?, distance_km = ? WHERE id = ?',
          [run.vehicleId, run.driverId, i, sched.departTime, sched.returnTime, sched.distanceKm, runId],
          conn,
        );
      } else {
        const r = await exec(
          'INSERT INTO route_runs (plan_id, vehicle_id, driver_id, sort_order, depart_time, return_time, distance_km) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [planId, run.vehicleId, run.driverId, i, sched.departTime, sched.returnTime, sched.distanceKm],
          conn,
        );
        runId = r.insertId;
      }
      for (const [seq, clientId] of run.clientIds.entries()) await upsertStop(clientId, runId, seq, sched.plannedTimes[seq]);
    }
    for (const clientId of b.unassignedClientIds) await upsertStop(clientId, null, 0, null);

    await exec(`DELETE FROM route_stops WHERE plan_id = ? ${clientIds.length ? 'AND client_id NOT IN (?)' : ''}`, [planId, clientIds], conn);
    await exec('UPDATE route_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [planId], conn);
  });

  res.json(await planDetail(planId));
});

// ---------- 実績記録 ----------

const recordBody = z.object({
  status: z.enum(['draft', 'confirmed']).optional(),
  note: z.string().trim().max(255).optional(),
  runs: z
    .array(z.object({ id: z.number().int().positive(), actualDepartTime: optTime, actualReturnTime: optTime, note: z.string().trim().max(255) }))
    .default([]),
  stops: z
    .array(
      z.object({
        id: z.number().int().positive(),
        actualTime: optTime,
        status: z.enum(['planned', 'done', 'absent']),
        note: z.string().trim().max(255),
      }),
    )
    .default([]),
});

plans.put('/:id/record', async (req, res) => {
  const planId = id(req.params.id);
  const b = recordBody.parse(req.body);
  await tx(async (conn) => {
    const r = await exec(
      'UPDATE route_plans SET status = COALESCE(?, status), note = COALESCE(?, note), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [b.status ?? null, b.note ?? null, planId],
      conn,
    );
    if (!r.affectedRows) throw new HttpError(404, '運行計画が見つかりません');
    for (const run of b.runs) {
      await exec(
        'UPDATE route_runs SET actual_depart_time = ?, actual_return_time = ?, note = ? WHERE id = ? AND plan_id = ?',
        [run.actualDepartTime, run.actualReturnTime, run.note, run.id, planId],
        conn,
      );
    }
    for (const s of b.stops) {
      await exec(
        'UPDATE route_stops SET actual_time = ?, status = ?, note = ? WHERE id = ? AND plan_id = ?',
        [s.actualTime, s.status, s.note, s.id, planId],
        conn,
      );
    }
  });
  res.json(await planDetail(planId));
});

plans.delete('/:id', async (req, res) => {
  await exec('DELETE FROM route_plans WHERE id = ?', [id(req.params.id)]);
  res.json({ ok: true });
});
