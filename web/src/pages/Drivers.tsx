import { useState } from 'react';
import { api, type Driver, type VehicleClass } from '../api.ts';
import { Dialog } from '../components/Dialog.tsx';
import { useLoad } from '../hooks.ts';

type Form = Omit<Driver, 'id'>;
const empty: Form = { name: '', kana: '', classIds: [], active: true, note: '' };

export function Drivers() {
  const { data: drivers, error, reload } = useLoad(() => api<Driver[]>('/drivers'), []);
  const { data: classes } = useLoad(() => api<VehicleClass[]>('/vehicle-classes'), []);
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const className = (id: number) => classes?.find((c) => c.id === id)?.name ?? '?';

  return (
    <>
      <h1>運転者一覧</h1>
      <div className="toolbar">
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({ id: null, form: empty })} disabled={!classes}>＋ 運転者を追加</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>名前</th><th>運転できる車の種類</th><th>備考</th><th /></tr>
          </thead>
          <tbody>
            {drivers?.map((d) => (
              <tr key={d.id} className={d.active ? '' : 'inactive'}>
                <td>
                  {d.name}
                  {d.kana && <div className="muted" style={{ fontSize: '0.8rem' }}>{d.kana}</div>}
                </td>
                <td>
                  {d.classIds.length
                    ? d.classIds.map((c) => <span key={c} className="badge" style={{ marginRight: 4 }}>{className(c)}</span>)
                    : <span className="badge danger">未設定</span>}
                </td>
                <td className="muted">{d.active ? d.note : `休止 ${d.note}`}</td>
                <td className="actions">
                  <button className="small" onClick={() => setEditing({ id: d.id, form: { ...d } })}>編集</button>
                </td>
              </tr>
            ))}
            {drivers && !drivers.length && <tr><td colSpan={4} className="muted">運転者が登録されていません</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && classes && (
        <DriverDialog
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

function DriverDialog({
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
      await api(id ? `/drivers/${id}` : '/drivers', { method: id ? 'PUT' : 'POST', body: f });
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
      await api(`/drivers/${id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title={id ? '運転者の編集' : '運転者の追加'}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      error={error}
      extraActions={id && <button type="button" className="danger" onClick={remove}>削除</button>}
    >
      <div className="form-grid">
        <label>名前 *</label>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={50} />
        <label>ふりがな</label>
        <input value={f.kana} onChange={(e) => set('kana', e.target.value)} maxLength={50} />
        <label>運転できる車</label>
        <div className="checks">
          {classes.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={f.classIds.includes(c.id)}
                onChange={(e) => set('classIds', e.target.checked ? [...f.classIds, c.id] : f.classIds.filter((x) => x !== c.id))}
              />
              {c.name}
            </label>
          ))}
        </div>
        <label>備考</label>
        <input value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={255} />
        <label>状態</label>
        <div className="checks">
          <label><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />勤務中（運行に使う）</label>
        </div>
      </div>
    </Dialog>
  );
}
