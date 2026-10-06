import { useState } from 'react';
import { CircleMarker, useMapEvents } from 'react-leaflet';
import { api, type GeocodeResult } from '../api.ts';
import { JAPAN_CENTER, MapBase } from './MapBase.tsx';

type Value = { address: string; lat: number | null; lng: number | null };

/** 住所入力＋住所検索＋地図クリックで位置を決める */
export function LocationPicker({
  value,
  onChange,
  fallbackCenter,
}: {
  value: Value;
  onChange: (v: Value) => void;
  fallbackCenter?: [number, number] | null;
}) {
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const has = value.lat != null && value.lng != null;
  const center: [number, number] = has ? [value.lat!, value.lng!] : (fallbackCenter ?? JAPAN_CENTER);

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      const r = await api<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(value.address)}`);
      if (r.length === 1) {
        onChange({ ...value, lat: r[0].lat, lng: r[0].lng });
        setResults(null);
      } else {
        setResults(r);
        if (!r.length) setError('見つかりませんでした。地図をクリックして位置を指定してください');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          style={{ flex: 1 }}
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="例: 東京都府中市宮西町2-24"
        />
        <button type="button" onClick={search} disabled={!value.address.trim() || searching}>
          {searching ? '検索中…' : '住所から位置'}
        </button>
      </div>
      {error && <div className="notice" style={{ marginTop: '0.5rem' }}>{error}</div>}
      {results && results.length > 0 && (
        <div className="checks" style={{ margin: '0.5rem 0', flexDirection: 'column' }}>
          {results.map((r) => (
            <button type="button" key={`${r.lat},${r.lng}`} onClick={() => (onChange({ ...value, lat: r.lat, lng: r.lng }), setResults(null))}>
              {r.title}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: '0.5rem' }}>
        <MapBase key={has ? 'set' : 'unset'} center={center} zoom={has ? 16 : fallbackCenter ? 13 : 5}>
          <ClickToSet onPick={(lat, lng) => onChange({ ...value, lat, lng })} />
          {has && <CircleMarker center={[value.lat!, value.lng!]} radius={9} pathOptions={{ color: '#c62828', fillOpacity: 0.7 }} />}
        </MapBase>
      </div>
      <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
        {has ? `緯度 ${value.lat!.toFixed(6)} / 経度 ${value.lng!.toFixed(6)}（地図クリックで修正できます）` : '位置が未設定です。住所検索か地図クリックで指定してください'}
        {has && (
          <button type="button" className="small" style={{ marginLeft: '0.5rem' }} onClick={() => onChange({ ...value, lat: null, lng: null })}>
            位置をクリア
          </button>
        )}
      </div>
    </div>
  );
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}
