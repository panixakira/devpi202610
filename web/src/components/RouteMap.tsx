import { Fragment } from 'react';
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import { JAPAN_CENTER, MapBase } from './MapBase.tsx';

export const RUN_COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#bf3989', '#0a7b83', '#cf5c00', '#57606a', '#3b5bdb'];

type Point = { lat: number | null; lng: number | null; label: string; wheelchair?: boolean };
export type MapRun = { color: string; name: string; points: Point[] };

/** 施設を起点・終点とした各便のルートを描く */
export function RouteMap({ facility, runs }: { facility: { lat: number | null; lng: number | null }; runs: MapRun[] }) {
  const depot: LatLngTuple | null = facility.lat != null && facility.lng != null ? [facility.lat, facility.lng] : null;
  const located = (p: Point): p is Point & { lat: number; lng: number } => p.lat != null && p.lng != null;
  const all: LatLngTuple[] = [...(depot ? [depot] : []), ...runs.flatMap((r) => r.points.filter(located).map((p) => [p.lat, p.lng] as LatLngTuple))];

  return (
    <MapBase center={depot ?? JAPAN_CENTER} zoom={depot ? 13 : 5} bounds={all.length > 1 ? all : null} className="map large">
      {runs.map((run) => {
        const pts = run.points.filter(located);
        const line: LatLngTuple[] = [...(depot ? [depot] : []), ...pts.map((p) => [p.lat, p.lng] as LatLngTuple), ...(depot ? [depot] : [])];
        return (
          <Fragment key={run.name}>
            <Polyline positions={line} pathOptions={{ color: run.color, weight: 3, opacity: 0.75 }} />
            {pts.map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lng]} radius={p.wheelchair ? 10 : 8} pathOptions={{ color: '#fff', weight: 2, fillColor: run.color, fillOpacity: 1 }}>
                <Tooltip>{`${run.name} ${i + 1}. ${p.label}${p.wheelchair ? '（車椅子）' : ''}`}</Tooltip>
              </CircleMarker>
            ))}
          </Fragment>
        );
      })}
      {depot && (
        <CircleMarker center={depot} radius={11} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d2330', fillOpacity: 1 }}>
          <Tooltip permanent direction="top">施設</Tooltip>
        </CircleMarker>
      )}
    </MapBase>
  );
}
