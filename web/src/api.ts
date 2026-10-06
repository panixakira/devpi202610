// API クライアントと型定義

export type Adl = '自立' | '見守り' | '一部介助' | '全介助';
export const ADLS: Adl[] = ['自立', '見守り', '一部介助', '全介助'];
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: [Day, string][] = [
  ['mon', '月'], ['tue', '火'], ['wed', '水'], ['thu', '木'], ['fri', '金'], ['sat', '土'], ['sun', '日'],
];
export type Direction = 'pickup' | 'dropoff';
export const DIRECTION_LABEL: Record<Direction, string> = { pickup: '迎え', dropoff: '送り' };

export type Client = {
  id: number;
  code: string;
  name: string;
  kana: string;
  adl: Adl;
  wheelchair: boolean;
  address: string;
  lat: number | null;
  lng: number | null;
  days: Day[];
  active: boolean;
  note: string;
};

export type VehicleClass = { id: number; name: string; sortOrder: number };

export type Vehicle = {
  id: number;
  name: string;
  model: string;
  classId: number;
  className: string;
  capacity: number;
  wheelchairCapacity: number;
  active: boolean;
  note: string;
};

export type Driver = { id: number; name: string; kana: string; classIds: number[]; active: boolean; note: string };

export type Settings = {
  facilityName: string;
  facilityAddress: string;
  facilityLat: number | null;
  facilityLng: number | null;
  avgSpeedKmh: number;
  stopMinutes: number;
  wheelchairMinutes: number;
  pickupArriveTime: string;
  dropoffDepartTime: string;
};

export type PlanSummary = {
  id: number;
  serviceDate: string;
  direction: Direction;
  status: 'draft' | 'confirmed';
  note: string;
  updatedAt: string;
  runCount: number;
  assignedCount: number;
  unassignedCount: number;
};

export type StopStatus = 'planned' | 'done' | 'absent';
export const STOP_STATUS_LABEL: Record<StopStatus, string> = { planned: '予定', done: '済', absent: '欠席' };

export type Stop = {
  id: number;
  runId: number | null;
  clientId: number;
  code: string;
  name: string;
  adl: Adl;
  wheelchair: boolean;
  address: string;
  lat: number | null;
  lng: number | null;
  seq: number;
  plannedTime: string | null;
  actualTime: string | null;
  status: StopStatus;
  unassignedReason: string;
  note: string;
};

export type Run = {
  id: number;
  vehicleId: number;
  vehicleName: string;
  vehicleModel: string;
  className: string;
  capacity: number;
  wheelchairCapacity: number;
  driverId: number | null;
  driverName: string | null;
  sortOrder: number;
  departTime: string | null;
  returnTime: string | null;
  distanceKm: number | null;
  actualDepartTime: string | null;
  actualReturnTime: string | null;
  note: string;
  stops: Stop[];
};

export type PlanDetail = Omit<PlanSummary, 'runCount' | 'assignedCount' | 'unassignedCount'> & {
  facility: { name: string; lat: number | null; lng: number | null };
  runs: Run[];
  unassigned: Stop[];
};

export type GeocodeResult = { title: string; lat: number; lng: number };

export class ApiError extends Error {}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `エラーが発生しました (${res.status})`);
  return data as T;
}

/** "HH:MM:SS" → "HH:MM" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
