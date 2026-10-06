import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  api,
  DIRECTION_LABEL,
  hhmm,
  STOP_STATUS_LABEL,
  type Client,
  type Driver,
  type PlanDetail as Plan,
  type Run,
  type Stop,
  type StopStatus,
  type Vehicle,
} from '../api.ts';
import { RouteMap, RUN_COLORS } from '../components/RouteMap.tsx';
import { useLoad } from '../hooks.ts';

type DraftRun = { key: string; id: number | null; vehicleId: number; driverId: number | null; clientIds: number[] };
type Draft = { runs: DraftRun[]; unassigned: number[] };
type StopRecord = { actualTime: string; status: StopStatus; note: string };
type RunRecord = { actualDepartTime: string; actualReturnTime: string; note: string };

const toDraft = (p: Plan): Draft => ({
  runs: p.runs.map((r) => ({ key: `r${r.id}`, id: r.id, vehicleId: r.vehicleId, driverId: r.driverId, clientIds: r.stops.map((s) => s.clientId) })),
  unassigned: p.unassigned.map((s) => s.clientId),
});

export function PlanDetail() {
  const planId = Number(useParams().id);
  const navigate = useNavigate();
  const { data: plan, setData: setPlan, error } = useLoad(() => api<Plan>(`/plans/${planId}`), [planId]);
  const { data: clients } = useLoad(() => api<Client[]>('/clients'), []);
  const { data: vehicles } = useLoad(() => api<Vehicle[]>('/vehicles'), []);
  const { data: drivers } = useLoad(() => api<Driver[]>('/drivers'), []);

  const [mode, setMode] = useState<'layout' | 'record'>('layout');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (plan) (setDraft(toDraft(plan)), setDirty(false));
  }, [plan]);

  const clientMap = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients]);
  const vehicleMap = useMemo(() => new Map((vehicles ?? []).map((v) => [v.id, v])), [vehicles]);

  if (error) return <div className="error">{error}</div>;
  if (!plan || !draft || !clients || !vehicles || !drivers) return <p className="muted">読み込み中…</p>;

  const title = `${plan.serviceDate} ${DIRECTION_LABEL[plan.direction]}`;
  const update = (fn: (d: Draft) => Draft) => (setDraft(fn(draft)), setDirty(true), setMsg(null));

  const saveLayout = async () => {
    setBusy(true);
    try {
      const body = {
        runs: draft.runs.map(({ id, vehicleId, driverId, clientIds }) => ({ id, vehicleId, driverId, clientIds })),
        unassignedClientIds: draft.unassigned,
      };
      setPlan(await api<Plan>(`/plans/${planId}/layout`, { method: 'PUT', body }));
      setMsg({ ok: true, text: '保存し、距離と予定時刻を再計算しました' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'draft' | 'confirmed') => {
    try {
      setPlan(await api<Plan>(`/plans/${planId}/record`, { method: 'PUT', body: { status } }));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const remove = async () => {
    if (!confirm(`${title} の運行を削除しますか？記録も消えます。`)) return;
    await api(`/plans/${planId}`, { method: 'DELETE' });
    navigate('/plans');
  };

  const mapRuns = draft.runs.map((r, i) => ({
    color: RUN_COLORS[i % RUN_COLORS.length],
    name: vehicleMap.get(r.vehicleId)?.name ?? '',
    points: r.clientIds.map((id) => {
      const c = clientMap.get(id);
      return { lat: c?.lat ?? null, lng: c?.lng ?? null, label: c?.name ?? '', wheelchair: c?.wheelchair };
    }),
  }));

  return (
    <>
      <div className="no-print">
        <div className="toolbar">
          <Link to="/plans">← 一覧</Link>
          <h1 style={{ margin: 0 }}>{title}</h1>
          {plan.status === 'confirmed' ? <span className="badge ok">確定</span> : <span className="badge warn">作成中</span>}
          <span className="spacer" />
          <div className="checks">
            <label><input type="radio" checked={mode === 'layout'} onChange={() => setMode('layout')} />ルート調整</label>
            <label>
              <input type="radio" checked={mode === 'record'} onChange={() => setMode('record')} disabled={dirty} />
              実績記録
            </label>
          </div>
          <button onClick={() => window.print()} disabled={dirty}>印刷（記録表）</button>
          {plan.status === 'draft'
            ? <button onClick={() => setStatus('confirmed')} disabled={dirty}>確定にする</button>
            : <button onClick={() => setStatus('draft')}>作成中に戻す</button>}
          <button className="danger" onClick={remove}>削除</button>
        </div>
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
        {dirty && <div className="notice">未保存の変更があります。「保存」で距離・予定時刻を再計算します。</div>}

        <RouteMap facility={plan.facility} runs={mapRuns} />

        {mode === 'layout' ? (
          <LayoutEditor
            plan={plan}
            draft={draft}
            update={update}
            clients={clientMap}
            vehicles={vehicles}
            drivers={drivers}
            busy={busy}
            dirty={dirty}
            onSave={saveLayout}
            onReset={() => (setDraft(toDraft(plan)), setDirty(false), setMsg(null))}
          />
        ) : (
          <RecordEditor plan={plan} onSaved={(p) => (setPlan(p), setMsg({ ok: true, text: '実績を保存しました' }))} onError={(t) => setMsg({ ok: false, text: t })} />
        )}
      </div>
      <PrintSheet plan={plan} />
    </>
  );
}

// ---------------- ルート調整 ----------------

function LayoutEditor({
  plan,
  draft,
  update,
  clients,
  vehicles,
  drivers,
  busy,
  dirty,
  onSave,
  onReset,
}: {
  plan: Plan;
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  clients: Map<number, Client>;
  vehicles: Vehicle[];
  drivers: Driver[];
  busy: boolean;
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const serverRun = (id: number | null): Run | undefined => plan.runs.find((r) => r.id === id);
  const serverStop = (clientId: number): Stop | undefined =>
    [...plan.runs.flatMap((r) => r.stops), ...plan.unassigned].find((s) => s.clientId === clientId);
  const inPlan = new Set([...draft.runs.flatMap((r) => r.clientIds), ...draft.unassigned]);
  const usedVehicles = new Set(draft.runs.map((r) => r.vehicleId));
  const usedDrivers = new Set(draft.runs.map((r) => r.driverId));

  /** 利用者を別の便（to = 便の index、-1 = 未割当）へ移す */
  const move = (clientId: number, to: number) =>
    update((d) => {
      const runs = d.runs.map((r) => ({ ...r, clientIds: r.clientIds.filter((c) => c !== clientId) }));
      const unassigned = d.unassigned.filter((c) => c !== clientId);
      if (to === -1) unassigned.push(clientId);
      else runs[to].clientIds.push(clientId);
      return { runs, unassigned };
    });

  const shift = (runIndex: number, pos: number, delta: number) =>
    update((d) => {
      const runs = [...d.runs];
      const ids = [...runs[runIndex].clientIds];
      [ids[pos], ids[pos + delta]] = [ids[pos + delta], ids[pos]];
      runs[runIndex] = { ...runs[runIndex], clientIds: ids };
      return { ...d, runs };
    });

  const patchRun = (i: number, patch: Partial<DraftRun>) =>
    update((d) => ({ ...d, runs: d.runs.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const canDrive = (driverId: number, vehicleId: number) => {
    const v = vehicles.find((x) => x.id === vehicleId);
    return !!v && !!drivers.find((x) => x.id === driverId)?.classIds.includes(v.classId);
  };

  const moveSelect = (clientId: number, current: number) => (
    <select value="" onChange={(e) => e.target.value !== '' && move(clientId, Number(e.target.value))} title="別の車へ移す">
      <option value="">移動…</option>
      {draft.runs.map((r, j) =>
        j === current ? null : <option key={r.key} value={j}>{vehicles.find((v) => v.id === r.vehicleId)?.name}</option>,
      )}
      {current !== -1 && <option value={-1}>未割当へ</option>}
    </select>
  );

  return (
    <>
      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button className="primary" onClick={onSave} disabled={busy || !dirty}>{busy ? '保存中…' : '保存（再計算）'}</button>
        <button onClick={onReset} disabled={!dirty}>変更を取り消す</button>
        <span className="spacer" />
        <select
          value=""
          onChange={(e) => {
            const vehicleId = Number(e.target.value);
            if (vehicleId) update((d) => ({ ...d, runs: [...d.runs, { key: `n${Date.now()}`, id: null, vehicleId, driverId: null, clientIds: [] }] }));
          }}
        >
          <option value="">＋ 車両（便）を追加…</option>
          {vehicles.filter((v) => v.active && !usedVehicles.has(v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value="" onChange={(e) => e.target.value && update((d) => ({ ...d, unassigned: [...d.unassigned, Number(e.target.value)] }))}>
          <option value="">＋ 利用者を追加…</option>
          {[...clients.values()].filter((c) => c.active && !inPlan.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
        </select>
      </div>

      <div className="runs">
        {draft.runs.map((r, i) => {
          const v = vehicles.find((x) => x.id === r.vehicleId)!;
          const wc = r.clientIds.filter((c) => clients.get(c)?.wheelchair).length;
          const over = r.clientIds.length > v.capacity || wc > v.wheelchairCapacity;
          const sr = serverRun(r.id);
          return (
            <div className="card" key={r.key} style={over ? { borderColor: 'var(--danger)' } : undefined}>
              <div className="run-head">
                <span className="run-color" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />
                <select value={r.vehicleId} onChange={(e) => patchRun(i, { vehicleId: Number(e.target.value) })}>
                  {vehicles.filter((x) => x.id === r.vehicleId || (x.active && !usedVehicles.has(x.id))).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <select value={r.driverId ?? ''} onChange={(e) => patchRun(i, { driverId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">運転者を選択</option>
                  {drivers.filter((d) => d.id === r.driverId || (d.active && !usedDrivers.has(d.id))).map((d) => (
                    <option key={d.id} value={d.id} disabled={!canDrive(d.id, r.vehicleId)}>
                      {d.name}{canDrive(d.id, r.vehicleId) ? '' : '（運転不可）'}
                    </option>
                  ))}
                </select>
                {r.clientIds.length === 0 && (
                  <button className="small danger" onClick={() => update((d) => ({ ...d, runs: d.runs.filter((_, j) => j !== i) }))}>便を外す</button>
                )}
              </div>
              <div className="run-meta">
                {v.className}・
                <span style={r.clientIds.length > v.capacity ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.clientIds.length}/{v.capacity} 人</span>・
                <span style={wc > v.wheelchairCapacity ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>車椅子 {wc}/{v.wheelchairCapacity}</span>
                {sr && !dirty && <> ・出発 {hhmm(sr.departTime)} → 帰着 {hhmm(sr.returnTime)}・約 {sr.distanceKm} km</>}
                {r.driverId && !canDrive(r.driverId, r.vehicleId) && <div style={{ color: 'var(--danger)' }}>この運転者はこの車を運転できません</div>}
              </div>
              <ol className="stops">
                {r.clientIds.map((cid, pos) => {
                  const c = clients.get(cid);
                  const st = serverStop(cid);
                  return (
                    <li key={cid}>
                      <span className="seq" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }}>{pos + 1}</span>
                      <span className="time">{!dirty && st?.runId === r.id ? hhmm(st?.plannedTime) : '--:--'}</span>
                      <span className="who">
                        {c?.name} {c?.wheelchair && <span className="badge wc">車椅子</span>}
                        <small>{c?.adl}・{c?.address}{c?.lat == null && ' ⚠位置未設定'}</small>
                      </span>
                      <button className="small" disabled={pos === 0} onClick={() => shift(i, pos, -1)} title="前へ">↑</button>
                      <button className="small" disabled={pos === r.clientIds.length - 1} onClick={() => shift(i, pos, 1)} title="後へ">↓</button>
                      {moveSelect(cid, i)}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}

        <div className="card" style={draft.unassigned.length ? { borderColor: 'var(--warn)' } : undefined}>
          <div className="run-head"><strong>未割当</strong><span className="muted">{draft.unassigned.length} 人</span></div>
          <ul className="stops">
            {draft.unassigned.map((cid) => {
              const c = clients.get(cid);
              const st = serverStop(cid);
              return (
                <li key={cid}>
                  <span className="who">
                    {c?.name} {c?.wheelchair && <span className="badge wc">車椅子</span>}
                    <small>{st?.runId === null && st.unassignedReason ? `理由: ${st.unassignedReason}` : c?.address}</small>
                  </span>
                  {moveSelect(cid, -1)}
                  <button className="small danger" onClick={() => update((d) => ({ ...d, unassigned: d.unassigned.filter((x) => x !== cid) }))} title="この日の運行から外す">外す</button>
                </li>
              );
            })}
            {!draft.unassigned.length && <li className="muted">全員が割り当て済みです</li>}
          </ul>
        </div>
      </div>
    </>
  );
}

// ---------------- 実績記録 ----------------

function RecordEditor({ plan, onSaved, onError }: { plan: Plan; onSaved: (p: Plan) => void; onError: (msg: string) => void }) {
  const init = () => ({
    runs: Object.fromEntries(
      plan.runs.map((r) => [r.id, { actualDepartTime: hhmm(r.actualDepartTime), actualReturnTime: hhmm(r.actualReturnTime), note: r.note }]),
    ) as Record<number, RunRecord>,
    stops: Object.fromEntries(
      plan.runs.flatMap((r) => r.stops).map((s) => [s.id, { actualTime: hhmm(s.actualTime), status: s.status, note: s.note }]),
    ) as Record<number, StopRecord>,
    note: plan.note,
  });
  const [rec, setRec] = useState(init);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRec(init()), [plan]);

  const now = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const setStop = (id: number, patch: Partial<StopRecord>) => setRec((r) => ({ ...r, stops: { ...r.stops, [id]: { ...r.stops[id], ...patch } } }));
  const setRun = (id: number, patch: Partial<RunRecord>) => setRec((r) => ({ ...r, runs: { ...r.runs, [id]: { ...r.runs[id], ...patch } } }));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        note: rec.note,
        runs: Object.entries(rec.runs).map(([id, r]) => ({ id: Number(id), ...r })),
        stops: Object.entries(rec.stops).map(([id, s]) => ({ id: Number(id), ...s })),
      };
      onSaved(await api<Plan>(`/plans/${plan.id}/record`, { method: 'PUT', body }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '実績を保存'}</button>
        <input style={{ flex: 1, minWidth: '12rem' }} placeholder="この運行全体のメモ" value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} maxLength={255} />
      </div>
      <div className="runs">
        {plan.runs.map((r, i) => {
          const rr = rec.runs[r.id];
          return (
            <div className="card" key={r.id}>
              <div className="run-head">
                <span className="run-color" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />
                <strong>{r.vehicleName}</strong>
                <span>{r.driverName}</span>
              </div>
              <div className="run-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                出発 {hhmm(r.departTime)}
                <input type="time" value={rr.actualDepartTime} onChange={(e) => setRun(r.id, { actualDepartTime: e.target.value })} />
                <button className="small" onClick={() => setRun(r.id, { actualDepartTime: now() })}>今</button>
                帰着 {hhmm(r.returnTime)}
                <input type="time" value={rr.actualReturnTime} onChange={(e) => setRun(r.id, { actualReturnTime: e.target.value })} />
                <button className="small" onClick={() => setRun(r.id, { actualReturnTime: now() })}>今</button>
              </div>
              <ol className="stops">
                {r.stops.map((s, pos) => {
                  const sr = rec.stops[s.id];
                  return (
                    <li key={s.id} style={sr.status === 'absent' ? { opacity: 0.6 } : undefined}>
                      <span className="seq" style={{ background: RUN_COLORS[i % RUN_COLORS.length] }}>{pos + 1}</span>
                      <span className="who">
                        {s.name} {s.wheelchair && <span className="badge wc">車椅子</span>}
                        <small>予定 {hhmm(s.plannedTime)}</small>
                      </span>
                      <select value={sr.status} onChange={(e) => setStop(s.id, { status: e.target.value as StopStatus })}>
                        {Object.entries(STOP_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <input type="time" value={sr.actualTime} onChange={(e) => setStop(s.id, { actualTime: e.target.value })} />
                      <button className="small" onClick={() => setStop(s.id, { actualTime: now(), status: 'done' })}>今</button>
                      <input className="note" placeholder="メモ" value={sr.note} onChange={(e) => setStop(s.id, { note: e.target.value })} maxLength={255} />
                    </li>
                  );
                })}
              </ol>
              <input style={{ width: '100%', marginTop: '0.5rem' }} placeholder="この便のメモ" value={rr.note} onChange={(e) => setRun(r.id, { note: e.target.value })} maxLength={255} />
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------- 印刷用 記録表 ----------------

function PrintSheet({ plan }: { plan: Plan }) {
  return (
    <div className="print-only print-sheet">
      <h1 style={{ fontSize: '14pt' }}>
        送迎運行記録表 {plan.facility.name}　{plan.serviceDate}　{DIRECTION_LABEL[plan.direction]}
        {plan.status === 'draft' && '（作成中）'}
      </h1>
      {plan.note && <p>メモ: {plan.note}</p>}
      {plan.runs.map((r) => (
        <div className="run-block" key={r.id}>
          <p style={{ margin: '0 0 2mm' }}>
            <strong>{r.vehicleName}</strong>（{r.vehicleModel}）　運転者: <strong>{r.driverName ?? '未定'}</strong>
            {'　'}出発 {hhmm(r.departTime)}（実績 {hhmm(r.actualDepartTime) || '　　：　　'}）
            {'　'}帰着 {hhmm(r.returnTime)}（実績 {hhmm(r.actualReturnTime) || '　　：　　'}）　約 {r.distanceKm} km
            {r.note && `　メモ: ${r.note}`}
          </p>
          <table>
            <thead>
              <tr><th>順</th><th>予定</th><th>管理番号</th><th>氏名</th><th>ADL</th><th>車椅子</th><th>住所</th><th>実績</th><th>状態</th><th>備考</th></tr>
            </thead>
            <tbody>
              {r.stops.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td>{hhmm(s.plannedTime)}</td>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.adl}</td>
                  <td>{s.wheelchair ? '○' : ''}</td>
                  <td>{s.address}</td>
                  <td className="blank">{hhmm(s.actualTime)}</td>
                  <td className="blank">{s.status === 'planned' ? '' : STOP_STATUS_LABEL[s.status]}</td>
                  <td className="blank">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {plan.unassigned.length > 0 && (
        <p>未割当: {plan.unassigned.map((s) => `${s.name}（${s.unassignedReason || '—'}）`).join('、')}</p>
      )}
    </div>
  );
}
