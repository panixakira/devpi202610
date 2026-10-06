import 'leaflet/dist/leaflet.css';
import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet';

export const JAPAN_CENTER: [number, number] = [36.2, 138.25];

/** 国土地理院の淡色地図を使った地図 */
export function MapBase({
  center,
  zoom,
  bounds,
  className = 'map',
  children,
}: {
  center: LatLngExpression;
  zoom: number;
  bounds?: LatLngBoundsExpression | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <MapContainer center={center} zoom={zoom} className={className} scrollWheelZoom>
      <TileLayer
        url="https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"
        attribution='<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>'
        maxZoom={18}
      />
      <FitBounds bounds={bounds} />
      <AutoResize />
      {children}
    </MapContainer>
  );
}

function FitBounds({ bounds }: { bounds?: LatLngBoundsExpression | null }) {
  const map = useMap();
  const key = JSON.stringify(bounds);
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }, [map, key]);
  return null;
}

/** ダイアログ内などで後からサイズが決まる場合に、地図タイルを描き直す */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}
