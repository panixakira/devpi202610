import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceKm,
  generatePlan,
  matchDrivers,
  scheduleRun,
  tourKm,
  twoOpt,
  type ClientIn,
  type ScheduleSettings,
  type VehicleIn,
} from './routing.ts';

const depot = { lat: 35.0, lng: 135.0 };
const settings: ScheduleSettings = {
  avgSpeedKmh: 30,
  stopMinutes: 3,
  wheelchairMinutes: 5,
  pickupArriveTime: '09:30:00',
  dropoffDepartTime: '16:00:00',
};

// 施設のまわりに円形に利用者を配置
function ring(n: number, radiusDeg = 0.05, wheelchairEvery = 0): ClientIn[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return {
      id: i + 1,
      wheelchair: wheelchairEvery > 0 && i % wheelchairEvery === 0,
      lat: depot.lat + radiusDeg * Math.sin(a),
      lng: depot.lng + radiusDeg * Math.cos(a),
    };
  });
}

test('distanceKm: 緯度 0.01 度 ≒ 1.1km × 道路係数', () => {
  const d = distanceKm(depot, { lat: 35.01, lng: 135.0 });
  assert.ok(d > 1.3 && d < 1.6, String(d));
});

test('matchDrivers: 運転できる区分だけで、最大数の組み合わせを作る', () => {
  const vehicles: VehicleIn[] = [
    { id: 1, classId: 3, capacity: 8, wheelchairCapacity: 2 }, // ワゴン
    { id: 2, classId: 2, capacity: 4, wheelchairCapacity: 0 }, // 普通車
  ];
  // A は両方運転できる、B は普通車のみ。素朴に A をワゴンに付けないと 2 台動かない
  const pairs = matchDrivers(vehicles, [
    { id: 10, classIds: [2, 3] },
    { id: 11, classIds: [2] },
  ]);
  assert.equal(pairs.get(1), 10);
  assert.equal(pairs.get(2), 11);
});

test('matchDrivers: 資格のない車両には割り当てない', () => {
  const pairs = matchDrivers([{ id: 1, classId: 4, capacity: 20, wheelchairCapacity: 0 }], [{ id: 10, classIds: [1, 2] }]);
  assert.equal(pairs.size, 0);
});

test('twoOpt は巡回距離を悪化させない', () => {
  const pts = ring(12).sort((a, b) => (a.id * 7) % 12 - (b.id * 7) % 12) as (ClientIn & { lat: number; lng: number })[];
  const before = tourKm(depot, pts);
  const after = tourKm(depot, twoOpt(depot, pts));
  assert.ok(after <= before + 1e-9);
});

test('generatePlan: 定員と車椅子枠を守り、全員を割り当てる', () => {
  const clients = ring(20, 0.05, 4); // 5 人が車椅子
  const vehicles: VehicleIn[] = [
    { id: 1, classId: 3, capacity: 8, wheelchairCapacity: 2 },
    { id: 2, classId: 3, capacity: 8, wheelchairCapacity: 2 },
    { id: 3, classId: 2, capacity: 4, wheelchairCapacity: 1 },
  ];
  const drivers = [
    { id: 10, classIds: [2, 3] },
    { id: 11, classIds: [2, 3] },
    { id: 12, classIds: [2] },
  ];
  const plan = generatePlan(depot, clients, vehicles, drivers, settings, 'pickup');
  assert.deepEqual(plan.unassigned, []);
  const assigned = plan.runs.flatMap((r) => r.clientIds).sort((a, b) => a - b);
  assert.deepEqual(assigned, clients.map((c) => c.id));
  for (const run of plan.runs) {
    const v = vehicles.find((x) => x.id === run.vehicleId)!;
    const wc = run.clientIds.filter((id) => clients[id - 1].wheelchair).length;
    assert.ok(run.clientIds.length <= v.capacity);
    assert.ok(wc <= v.wheelchairCapacity);
    assert.equal(run.returnTime, '09:30:00', '迎えは施設到着目標に合わせる');
  }
  assert.equal(new Set(plan.runs.map((r) => r.driverId)).size, plan.runs.length, '運転者の重複なし');
});

test('generatePlan: 位置情報なし・定員不足・車椅子枠不足を理由付きで未割当にする', () => {
  const clients: ClientIn[] = [
    { id: 1, wheelchair: false, lat: null, lng: null },
    { id: 2, wheelchair: true, lat: 35.01, lng: 135.0 },
    { id: 3, wheelchair: false, lat: 35.02, lng: 135.0 },
    { id: 4, wheelchair: false, lat: 35.03, lng: 135.0 },
  ];
  const plan = generatePlan(
    depot,
    clients,
    [{ id: 1, classId: 2, capacity: 1, wheelchairCapacity: 0 }],
    [{ id: 10, classIds: [2] }],
    settings,
    'dropoff',
  );
  const reasons = Object.fromEntries(plan.unassigned.map((u) => [u.clientId, u.reason]));
  assert.equal(reasons[1], '位置情報なし');
  assert.equal(reasons[2], '車椅子枠不足');
  assert.equal(plan.runs[0].clientIds.length, 1);
  // 1 席しかないので 3 と 4 のどちらか一方だけ乗れる
  assert.equal(Object.keys(reasons).length, 3);
  assert.equal(reasons[3] ?? reasons[4], '定員不足');
});

test('generatePlan: 送りは施設に近い人から降ろす', () => {
  const clients: ClientIn[] = [
    { id: 1, wheelchair: false, lat: 35.03, lng: 135.0 },
    { id: 2, wheelchair: false, lat: 35.01, lng: 135.0 },
    { id: 3, wheelchair: false, lat: 35.02, lng: 135.0 },
  ];
  const vehicles = [{ id: 1, classId: 2, capacity: 4, wheelchairCapacity: 0 }];
  const drivers = [{ id: 10, classIds: [2] }];
  assert.deepEqual(generatePlan(depot, clients, vehicles, drivers, settings, 'dropoff').runs[0].clientIds, [2, 3, 1]);
  assert.deepEqual(generatePlan(depot, clients, vehicles, drivers, settings, 'pickup').runs[0].clientIds, [1, 3, 2]);
});

test('scheduleRun: 送りは出発時刻から積み上げる', () => {
  // 往復 0.02 度 × 2 ≒ 4.4km × 道路係数 1.3
  const s = scheduleRun(
    depot,
    [
      { wheelchair: false, lat: 35.01, lng: 135.0 },
      { wheelchair: true, lat: 35.02, lng: 135.0 },
    ],
    settings,
    'dropoff',
  );
  assert.equal(s.departTime, '16:00:00');
  assert.equal(s.plannedTimes.length, 2);
  assert.ok(s.plannedTimes[0] < s.plannedTimes[1]);
  assert.ok(s.returnTime > s.plannedTimes[1]);
  assert.ok(s.distanceKm > 5 && s.distanceKm < 7, String(s.distanceKm));
});
