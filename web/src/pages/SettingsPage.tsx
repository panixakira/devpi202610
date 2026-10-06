import { useEffect, useState, type FormEvent } from 'react';
import { api, hhmm, type Settings, type VehicleClass } from '../api.ts';
import { LocationPicker } from '../components/LocationPicker.tsx';
import { useLoad } from '../hooks.ts';

export function SettingsPage() {
  const { data, error } = useLoad(() => api<Settings>('/settings'), []);
  const [f, setF] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setF(data), [data]);

  if (error) return <div className="error">{error}</div>;
  if (!f) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/settings', { method: 'PUT', body: { ...f, pickupArriveTime: hhmm(f.pickupArriveTime), dropoffDepartTime: hhmm(f.dropoffDepartTime) } });
      setMsg({ ok: true, text: '保存しました' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      <h1>設定</h1>
      <form className="card" onSubmit={save}>
        <h2 style={{ marginTop: 0 }}>施設・運行条件</h2>
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
        <div className="form-grid">
          <label>施設名</label>
          <input value={f.facilityName} onChange={(e) => set('facilityName', e.target.value)} maxLength={100} />
          <label className="full">施設の住所・位置（ルートの起点・終点）</label>
          <div className="full">
            <LocationPicker
              value={{ address: f.facilityAddress, lat: f.facilityLat, lng: f.facilityLng }}
              onChange={(v) => setF({ ...f, facilityAddress: v.address, facilityLat: v.lat, facilityLng: v.lng })}
            />
          </div>
          <label>迎えの到着目標</label>
          <input type="time" value={hhmm(f.pickupArriveTime)} onChange={(e) => set('pickupArriveTime', e.target.value)} required />
          <label>送りの出発時刻</label>
          <input type="time" value={hhmm(f.dropoffDepartTime)} onChange={(e) => set('dropoffDepartTime', e.target.value)} required />
          <label>平均速度 (km/h)</label>
          <input type="number" min={5} max={80} step={0.5} value={f.avgSpeedKmh} onChange={(e) => set('avgSpeedKmh', Number(e.target.value))} />
          <label>乗降時間（分）</label>
          <input type="number" min={0} max={60} value={f.stopMinutes} onChange={(e) => set('stopMinutes', Number(e.target.value))} />
          <label>車椅子の乗降（分）</label>
          <input type="number" min={0} max={60} value={f.wheelchairMinutes} onChange={(e) => set('wheelchairMinutes', Number(e.target.value))} />
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          距離は直線距離 × 1.3 で道路距離を近似しています。予定時刻の目安としてお使いください。
        </p>
        <div className="dialog-actions"><button className="primary">保存</button></div>
      </form>
      <VehicleClasses />
    </>
  );
}

/** 車の大きさ（運転者の「運転できる車」と対応） */
function VehicleClasses() {
  const { data, error, reload } = useLoad(() => api<VehicleClass[]>('/vehicle-classes'), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>車の大きさ（区分）</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>運転者ごとに、どの区分の車を運転できるかを設定します。</p>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="table-wrap" style={{ maxWidth: 520 }}>
        <table>
          <thead><tr><th>区分名</th><th className="num">並び順</th><th /></tr></thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{c.sortOrder}</td>
                <td className="actions">
                  <button
                    className="small"
                    onClick={() => {
                      const n = prompt('区分名', c.name);
                      if (n) run(() => api(`/vehicle-classes/${c.id}`, { method: 'PUT', body: { name: n, sortOrder: c.sortOrder } }));
                    }}
                  >
                    名前変更
                  </button>{' '}
                  <button
                    className="small danger"
                    onClick={() => confirm(`「${c.name}」を削除しますか？`) && run(() => api(`/vehicle-classes/${c.id}`, { method: 'DELETE' }))}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="toolbar"
        style={{ marginTop: '0.75rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          const sortOrder = Math.max(0, ...(data ?? []).map((c) => c.sortOrder)) + 10;
          run(() => api('/vehicle-classes', { method: 'POST', body: { name, sortOrder } })).then(() => setName(''));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新しい区分名" required maxLength={50} />
        <button>追加</button>
      </form>
    </div>
  );
}
