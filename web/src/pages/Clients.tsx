import { useState } from 'react';
import { ADLS, api, DAYS, type Client, type Settings } from '../api.ts';
import { Dialog } from '../components/Dialog.tsx';
import { LocationPicker } from '../components/LocationPicker.tsx';
import { useLoad } from '../hooks.ts';

type Form = Omit<Client, 'id'>;
const empty: Form = { code: '', name: '', kana: '', adl: '自立', wheelchair: false, address: '', lat: null, lng: null, days: [], active: true, note: '' };

export function Clients() {
  const { data: clients, error, reload } = useLoad(() => api<Client[]>('/clients'), []);
  const { data: settings } = useLoad(() => api<Settings>('/settings'), []);
  const [editing, setEditing] = useState<{ id: number | null; form: Form } | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const list = (clients ?? []).filter(
    (c) => (showInactive || c.active) && [c.code, c.name, c.kana, c.address].some((v) => v.includes(query.trim())),
  );
  const facility: [number, number] | null =
    settings?.facilityLat != null && settings.facilityLng != null ? [settings.facilityLat, settings.facilityLng] : null;

  return (
    <>
      <h1>利用者一覧</h1>
      <div className="toolbar">
        <input placeholder="管理番号・名前・住所で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="checks">
          <label><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />利用終了も表示</label>
        </div>
        <span className="spacer" />
        <span className="muted">{list.length} 人</span>
        <button className="primary" onClick={() => setEditing({ id: null, form: empty })}>＋ 利用者を追加</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>管理番号</th><th>名前</th><th>ADL</th><th>車椅子</th><th>住所</th><th>位置</th><th>利用曜日</th><th>備考</th><th />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'inactive'}>
                <td>{c.code}</td>
                <td>
                  {c.name}
                  {c.kana && <div className="muted" style={{ fontSize: '0.8rem' }}>{c.kana}</div>}
                </td>
                <td>{c.adl}</td>
                <td>{c.wheelchair && <span className="badge wc">車椅子</span>}</td>
                <td>{c.address}</td>
                <td>{c.lat != null ? <span className="badge ok">設定済</span> : <span className="badge danger">未設定</span>}</td>
                <td>{DAYS.filter(([d]) => c.days.includes(d)).map(([, l]) => l).join('')}</td>
                <td className="muted">{c.active ? c.note : `利用終了 ${c.note}`}</td>
                <td className="actions">
                  <button className="small" onClick={() => setEditing({ id: c.id, form: { ...c } })}>編集</button>
                </td>
              </tr>
            ))}
            {clients && !list.length && (
              <tr><td colSpan={9} className="muted">利用者が登録されていません</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <ClientDialog
          id={editing.id}
          initial={editing.form}
          facility={facility}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), reload())}
        />
      )}
    </>
  );
}

function ClientDialog({
  id,
  initial,
  facility,
  onClose,
  onSaved,
}: {
  id: number | null;
  initial: Form;
  facility: [number, number] | null;
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
      await api(id ? `/clients/${id}` : '/clients', { method: id ? 'PUT' : 'POST', body: f });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`「${f.name}」を削除しますか？\n運行記録がある場合は削除できません（「利用中」を外してください）。`)) return;
    try {
      await api(`/clients/${id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title={id ? '利用者の編集' : '利用者の追加'}
      onClose={onClose}
      onSubmit={save}
      busy={busy}
      error={error}
      extraActions={id && <button type="button" className="danger" onClick={remove}>削除</button>}
    >
      <div className="form-grid">
        <label>管理番号 *</label>
        <input value={f.code} onChange={(e) => set('code', e.target.value)} required maxLength={20} />
        <label>名前 *</label>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={50} />
        <label>ふりがな</label>
        <input value={f.kana} onChange={(e) => set('kana', e.target.value)} maxLength={50} />
        <label>ADL</label>
        <select value={f.adl} onChange={(e) => set('adl', e.target.value as Form['adl'])}>
          {ADLS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <label>車椅子</label>
        <div className="checks">
          <label><input type="checkbox" checked={f.wheelchair} onChange={(e) => set('wheelchair', e.target.checked)} />車椅子のまま乗車する</label>
        </div>
        <label>利用曜日</label>
        <div className="checks">
          {DAYS.map(([d, l]) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={f.days.includes(d)}
                onChange={(e) => set('days', e.target.checked ? [...f.days, d] : f.days.filter((x) => x !== d))}
              />
              {l}
            </label>
          ))}
        </div>
        <label className="full">住所・位置</label>
        <div className="full">
          <LocationPicker
            value={{ address: f.address, lat: f.lat, lng: f.lng }}
            onChange={(v) => setF((prev) => ({ ...prev, ...v }))}
            fallbackCenter={facility}
          />
        </div>
        <label>備考</label>
        <input value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={255} />
        <label>状態</label>
        <div className="checks">
          <label><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />利用中</label>
        </div>
      </div>
    </Dialog>
  );
}
