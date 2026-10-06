import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  api,
  ApiError,
  DAYS,
  DIRECTION_LABEL,
  type Client,
  type Day,
  type Direction,
  type Driver,
  type PlanDetail,
  type PlanSummary,
  type Vehicle,
} from '../api.ts';
import { useLoad } from '../hooks.ts';

const WEEKDAY: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayOf = (date: string) => WEEKDAY[new Date(`${date}T00:00:00`).getDay()];
const dayLabel = (date: string) => DAYS.find(([d]) => d === dayOf(date))?.[1] ?? '';
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Plans() {
  const { data: plans, error } = useLoad(() => api<PlanSummary[]>('/plans'), []);
  return (
    <>
      <h1>運行ルート記録表</h1>
      <NewPlan />
      <h2>作成済みの運行</h2>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>日付</th><th>区分</th><th>状態</th><th className="num">便数</th><th className="num">乗車予定</th><th className="num">未割当</th><th>更新</th><th /></tr>
          </thead>
          <tbody>
            {plans?.map((p) => (
              <tr key={p.id}>
                <td>{p.serviceDate}（{dayLabel(p.serviceDate)}）</td>
                <td>{DIRECTION_LABEL[p.direction]}</td>
                <td>{p.status === 'confirmed' ? <span className="badge ok">確定</span> : <span className="badge warn">作成中</span>}</td>
                <td className="num">{p.runCount}</td>
                <td className="num">{p.assignedCount} 人</td>
                <td className="num">{p.unassignedCount > 0 ? <span className="badge danger">{p.unassignedCount} 人</span> : 0}</td>
                <td className="muted">{p.updatedAt.slice(5, 16)}</td>
                <td className="actions"><Link className="button small" to={`/plans/${p.id}`}>開く</Link></td>
              </tr>
            ))}
            {plans && !plans.length && <tr><td colSpan={8} className="muted">まだ作成されていません</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewPlan() {
  const navigate = useNavigate();
  const { data: clients } = useLoad(() => api<Client[]>('/clients'), []);
  const { data: vehicles } = useLoad(() => api<Vehicle[]>('/vehicles'), []);
  const { data: drivers } = useLoad(() => api<Driver[]>('/drivers'), []);

  const [date, setDate] = useState(today());
  const [direction, setDirection] = useState<Direction>('pickup');
  const [clientIds, setClientIds] = useState<number[]>([]);
  const [vehicleIds, setVehicleIds] = useState<number[]>([]);
  const [driverIds, setDriverIds] = useState<number[]>([]);
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeClients = (clients ?? []).filter((c) => c.active);

  // 初期選択: 送りは同日の迎えに乗った人、それ以外は利用曜日で選ぶ
  useEffect(() => {
    if (!clients) return;
    let cancelled = false;
    (async () => {
      if (direction === 'dropoff') {
        const [pickup] = await api<PlanSummary[]>(`/plans?from=${date}&to=${date}`).then((l) => l.filter((p) => p.direction === 'pickup'));
        if (pickup) {
          const detail = await api<PlanDetail>(`/plans/${pickup.id}`);
          const ids = detail.runs.flatMap((r) => r.stops).filter((s) => s.status !== 'absent').map((s) => s.clientId);
          if (!cancelled) (setClientIds(ids), setHint('同じ日の「迎え」に乗った方（欠席を除く）を選んでいます'));
          return;
        }
      }
      if (!cancelled) {
        setClientIds(clients.filter((c) => c.active && c.days.includes(dayOf(date))).map((c) => c.id));
        setHint(`${dayLabel(date)}曜日の利用者を選んでいます`);
      }
    })().catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clients, date, direction]);

  useEffect(() => {
    if (vehicles) setVehicleIds(vehicles.filter((v) => v.active).map((v) => v.id));
  }, [vehicles]);
  useEffect(() => {
    if (drivers) setDriverIds(drivers.filter((d) => d.active).map((d) => d.id));
  }, [drivers]);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const generate = async (replace = false): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number }>('/plans/generate', { method: 'POST', body: { serviceDate: date, direction, clientIds, vehicleIds, driverIds, replace } });
      navigate(`/plans/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.message.includes('すでに作成済み') && confirm(`${e.message}。\n作り直しますか？（調整内容・記録は消えます）`)) {
        return generate(true);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const wc = activeClients.filter((c) => clientIds.includes(c.id) && c.wheelchair).length;
  const seats = (vehicles ?? []).filter((v) => vehicleIds.includes(v.id));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>ルートを自動生成</h2>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
          <option value="pickup">迎え</option>
          <option value="dropoff">送り</option>
        </select>
        <span className="spacer" />
        <button className="primary" onClick={() => generate()} disabled={busy || !clientIds.length}>
          {busy ? '生成中…' : '生成する'}
        </button>
      </div>

      <h3 style={{ fontSize: '0.95rem' }}>
        乗車する利用者（{clientIds.length} 人 / うち車椅子 {wc} 人）
        <span className="muted" style={{ fontWeight: 'normal', marginLeft: '0.75rem' }}>{hint}</span>
      </h3>
      <div className="checks">
        {activeClients.map((c) => (
          <label key={c.id} title={c.address}>
            <input type="checkbox" checked={clientIds.includes(c.id)} onChange={() => toggle(clientIds, setClientIds, c.id)} />
            {c.name}
            {c.wheelchair && <span className="badge wc">車椅子</span>}
            {c.lat == null && <span className="badge danger">位置未設定</span>}
          </label>
        ))}
      </div>

      <h3 style={{ fontSize: '0.95rem' }}>
        使う車両（{seats.length} 台 / 定員計 {seats.reduce((a, v) => a + v.capacity, 0)} 人・車椅子 {seats.reduce((a, v) => a + v.wheelchairCapacity, 0)} 台）
      </h3>
      <div className="checks">
        {(vehicles ?? []).filter((v) => v.active).map((v) => (
          <label key={v.id}>
            <input type="checkbox" checked={vehicleIds.includes(v.id)} onChange={() => toggle(vehicleIds, setVehicleIds, v.id)} />
            {v.name}（{v.className}・{v.capacity}人・♿{v.wheelchairCapacity}）
          </label>
        ))}
      </div>

      <h3 style={{ fontSize: '0.95rem' }}>出勤する運転者（{driverIds.length} 人）</h3>
      <div className="checks">
        {(drivers ?? []).filter((d) => d.active).map((d) => (
          <label key={d.id}>
            <input type="checkbox" checked={driverIds.includes(d.id)} onChange={() => toggle(driverIds, setDriverIds, d.id)} />
            {d.name}
          </label>
        ))}
      </div>
    </div>
  );
}
