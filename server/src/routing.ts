// 運行ルート生成ロジック（DB 非依存の純粋関数）

export type LatLng = { lat: number; lng: number };
export type Direction = 'pickup' | 'dropoff';

export type ClientIn = { id: number; wheelchair: boolean; lat: number | null; lng: number | null };
export type VehicleIn = { id: number; classId: number; capacity: number; wheelchairCapacity: number };
export type DriverIn = { id: number; classIds: number[] };

export type ScheduleSettings = {
  avgSpeedKmh: number;
  stopMinutes: number;
  wheelchairMinutes: number;
  pickupArriveTime: string; // HH:MM[:SS]
  dropoffDepartTime: string;
};

export type RunSchedule = {
  distanceKm: number;
  departTime: string;
  returnTime: string;
  plannedTimes: string[];
};

export type GeneratedRun = RunSchedule & { vehicleId: number; driverId: number; clientIds: number[] };
export type Unassigned = { clientId: number; reason: string };
export type GeneratedPlan = { runs: GeneratedRun[]; unassigned: Unassigned[] };

/** 直線距離を道路距離に近づけるための係数 */
const ROAD_FACTOR = 1.3;

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * ROAD_FACTOR;
}

function hasCoord(c: { lat: number | null; lng: number | null }): c is LatLng {
  return c.lat != null && c.lng != null;
}

/** 座標がない地点は直前地点と同じ場所として扱う（距離 0） */
function legKm(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number {
  return hasCoord(a) && hasCoord(b) ? distanceKm(a, b) : 0;
}

/**
 * 車両と運転者の割り当て（二部マッチング）。
 * 大きい車両から順に増加路を探すので、運転者が足りないときは大きい車両が優先される。
 */
export function matchDrivers(vehicles: VehicleIn[], drivers: DriverIn[]): Map<number, number> {
  const sorted = [...vehicles].sort((a, b) => b.capacity - a.capacity || b.wheelchairCapacity - a.wheelchairCapacity);
  const driverOf = new Map<number, number>(); // vehicleId -> driverId
  const vehicleOf = new Map<number, number>(); // driverId -> vehicleId
  // 資格の少ない運転者から試すと、汎用的な運転者が後の車両に残りやすい
  const byFlex = [...drivers].sort((a, b) => a.classIds.length - b.classIds.length);

  const tryAssign = (v: VehicleIn, seen: Set<number>): boolean => {
    for (const d of byFlex) {
      if (!d.classIds.includes(v.classId) || seen.has(d.id)) continue;
      seen.add(d.id);
      const current = vehicleOf.get(d.id);
      if (current === undefined || tryAssign(sorted.find((x) => x.id === current)!, seen)) {
        driverOf.set(v.id, d.id);
        vehicleOf.set(d.id, v.id);
        return true;
      }
    }
    return false;
  };

  for (const v of sorted) tryAssign(v, new Set());
  return driverOf;
}

export function tourKm(depot: LatLng, pts: LatLng[]): number {
  let total = 0;
  let prev = depot;
  for (const p of pts) {
    total += distanceKm(prev, p);
    prev = p;
  }
  return total + distanceKm(prev, depot);
}

/** 施設を起点・終点とする巡回路を 2-opt で改善 */
export function twoOpt<T extends LatLng>(depot: LatLng, pts: T[]): T[] {
  let route = [...pts];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const a = i === 0 ? depot : route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = k === route.length - 1 ? depot : route[k + 1];
        const delta = distanceKm(a, c) + distanceKm(b, d) - distanceKm(a, b) - distanceKm(c, d);
        if (delta < -1e-9) {
          route = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
          improved = true;
        }
      }
    }
  }
  return route;
}

function cheapestInsertion(depot: LatLng, route: LatLng[], p: LatLng): { cost: number; index: number } {
  let best = { cost: Infinity, index: 0 };
  for (let i = 0; i <= route.length; i++) {
    const a = i === 0 ? depot : route[i - 1];
    const b = i === route.length ? depot : route[i];
    const cost = distanceKm(a, p) + distanceKm(p, b) - (route.length === 0 ? 0 : distanceKm(a, b));
    if (cost < best.cost) best = { cost, index: i };
  }
  return best;
}

/**
 * 向きをそろえる。迎えは最後の立ち寄りが施設に近い順、送りは最初の立ち寄りが施設に近い順。
 */
function orient<T extends LatLng>(depot: LatLng, route: T[], direction: Direction): T[] {
  if (route.length < 2) return route;
  const firstNear = distanceKm(depot, route[0]) <= distanceKm(depot, route[route.length - 1]);
  const wantFirstNear = direction === 'dropoff';
  return firstNear === wantFirstNear ? route : [...route].reverse();
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

/** 立ち寄り順が決まった 1 便の距離と予定時刻を計算 */
export function scheduleRun(
  depot: LatLng,
  stops: { wheelchair: boolean; lat: number | null; lng: number | null }[],
  settings: ScheduleSettings,
  direction: Direction,
): RunSchedule {
  const travelMin = (km: number) => (km / settings.avgSpeedKmh) * 60;
  const dwell = (s: { wheelchair: boolean }) => (s.wheelchair ? settings.wheelchairMinutes : settings.stopMinutes);

  // 出発を 0 分として各地点への到着経過時間を出す
  let km = 0;
  let elapsed = 0;
  let prev: { lat: number | null; lng: number | null } = depot;
  const arrive: number[] = [];
  for (const s of stops) {
    const leg = legKm(prev, s);
    km += leg;
    elapsed += travelMin(leg);
    arrive.push(elapsed);
    elapsed += dwell(s);
    // 座標がない地点は位置を更新しない
    if (hasCoord(s)) prev = s;
  }
  const back = legKm(prev, depot);
  km += back;
  elapsed += travelMin(back);

  const depart =
    direction === 'pickup' ? toMinutes(settings.pickupArriveTime) - elapsed : toMinutes(settings.dropoffDepartTime);
  return {
    distanceKm: Math.round(km * 10) / 10,
    departTime: fromMinutes(depart),
    returnTime: fromMinutes(depart + elapsed),
    plannedTimes: arrive.map((a) => fromMinutes(depart + a)),
  };
}

export function generatePlan(
  depot: LatLng,
  clients: ClientIn[],
  vehicles: VehicleIn[],
  drivers: DriverIn[],
  settings: ScheduleSettings,
  direction: Direction,
): GeneratedPlan {
  const unassigned: Unassigned[] = [];
  const pairs = matchDrivers(vehicles, drivers);

  type Run = { vehicle: VehicleIn; driverId: number; stops: (ClientIn & LatLng)[]; wheelchairs: number };
  const runs: Run[] = vehicles
    .filter((v) => pairs.has(v.id))
    .sort((a, b) => b.capacity - a.capacity)
    .map((vehicle) => ({ vehicle, driverId: pairs.get(vehicle.id)!, stops: [], wheelchairs: 0 }));

  const located: (ClientIn & LatLng)[] = [];
  for (const c of clients) {
    if (hasCoord(c)) located.push(c);
    else unassigned.push({ clientId: c.id, reason: '位置情報なし' });
  }

  // 車椅子の方（枠が限られる）→ 施設から遠い方 の順に割り当てる
  located.sort(
    (a, b) => Number(b.wheelchair) - Number(a.wheelchair) || distanceKm(depot, b) - distanceKm(depot, a),
  );

  for (const c of located) {
    let best: { run: Run; index: number; cost: number } | null = null;
    for (const run of runs) {
      if (run.stops.length >= run.vehicle.capacity) continue;
      if (c.wheelchair && run.wheelchairs >= run.vehicle.wheelchairCapacity) continue;
      const ins = cheapestInsertion(depot, run.stops, c);
      if (!best || ins.cost < best.cost) best = { run, ...ins };
    }
    if (!best) {
      const reason =
        runs.length === 0
          ? '運転できる運転者がいる車両がない'
          : c.wheelchair && runs.some((r) => r.stops.length < r.vehicle.capacity)
            ? '車椅子枠不足'
            : '定員不足';
      unassigned.push({ clientId: c.id, reason });
      continue;
    }
    best.run.stops.splice(best.index, 0, c);
    if (c.wheelchair) best.run.wheelchairs++;
  }

  return {
    runs: runs
      .filter((r) => r.stops.length > 0)
      .map((r) => {
        const ordered = orient(depot, twoOpt(depot, r.stops), direction);
        return {
          vehicleId: r.vehicle.id,
          driverId: r.driverId,
          clientIds: ordered.map((s) => s.id),
          ...scheduleRun(depot, ordered, settings, direction),
        };
      }),
    unassigned,
  };
}

