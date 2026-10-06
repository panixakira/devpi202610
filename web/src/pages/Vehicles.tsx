import { useState } from 'react';
import { api, type Vehicle, type VehicleClass } from '../api.ts';
import { Dialog } from '../components/Dialog.tsx';
import { useLoad } from '../hooks.ts';

type Form = Omit<Vehicle, 'id' | 'className'>;

export function Vehicles() {
  const { data: vehicles, error, reload } = useLoad(() => api<Vehicle[]>('/vehicles'), []);
  const { data: classes } = useLoad(() => api<VehicleClass[]>('/vehicle-classes'), []);
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);

  const empty = (): Form => ({ name: '', model: '', classId: classes?.[0]?.id ?? 0, capacity: 4, wheelchairCapacity: 0, active: true, note: '' });

  return (
    <>
      <h1>車両一覧</h1>
      <div className="toolbar">
        <span className="muted">乗れる人数は運転者を除いた利用者の人数です。車椅子数はそのうち車椅子のまま乗れる台数です。</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({ id: null, form: empty() })} disabled={!classes}>＋ 車両を追加</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>車両名</th><th>車種</th><th>大きさ</th><th className="num">乗れる人数</th><th className="num">車椅子数</th><th>備考</th><th /></tr>
          </thead>
          <tbody>
            {vehicles?.map((v) => (
              <tr key={v.id} className={v.active ? '' : 'inactive'}>
                <td>{v.name}</td>
                <td>{v.model}</td>
                <td>{v.className}</td>
                <td className="num">{v.capacity} 人</td>
                <td className="num">{v.wheelchairCapacity} 台</td>
                <td className="muted">{v.active ? v.note : `使用停止 ${v.note}`}</td>
                <td className="actions">
                  <button className="small" onClick={() => setEditing({ id: v.id, form: { ...v } })}>編集</button>
                </td>
              </tr>
            ))}
            {vehicles && !vehicles.length && <tr><td colSpan={7} className="muted">車両が登録されていません</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && classes && (
        <VehicleDialog
          id={editing.id}
          initial={editing.form}
          classes={classes}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), reload())}
        />
      )}
    </>
  );
}

function VehicleDialog({
  id,
  initial,
  classes,
  onClose,
  onSaved,
}: {
  id: number | null;
  initial: Form;
  classes: VehicleClass[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(id ? `/vehicles/${id}` : '/vehicles', { method: id ? 'PUT' : 'POST', body: f });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`「${f.name}」を削除しますか？`)) return;
    try {
      await api(`/vehicles/${id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title={id ? '車両の編集' : '車両の追加'}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      error={error}
      extraActions={id && <button type="button" className="danger" onClick={remove}>削除</button>}
    >
      <div className="form-grid">
        <label>車両名 *</label>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={50} placeholder="例: ハイエース1号 / 品川 300 あ 12-34" />
        <label>車種</label>
        <input value={f.model} onChange={(e) => set('model', e.target.value)} maxLength={100} placeholder="例: トヨタ ハイエース 福祉車両" />
        <label>車の大きさ</label>
        <select value={f.classId} onChange={(e) => set('classId', Number(e.target.value))}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label>乗れる人数</label>
        <input type="number" min={1} max={30} value={f.capacity} onChange={(e) => set('capacity', Number(e.target.value))} required />
        <label>車椅子数</label>
        <input type="number" min={0} max={f.capacity} value={f.wheelchairCapacity} onChange={(e) => set('wheelchairCapacity', Number(e.target.value))} required />
        <label>備考</label>
        <input value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={255} />
        <label>状態</label>
        <div className="checks">
          <label><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />使用中</label>
        </div>
      </div>
    </Dialog>
  );
}
