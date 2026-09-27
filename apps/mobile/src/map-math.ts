/**
 * A small map without a map library: the tiles that cover a set of places at the closest zoom
 * that fits them all, and where each pin sits on it.
 */
const TILE = 256;

/**
 * Where the map pictures come from. OpenStreetMap data drawn by CARTO; fine for light use with
 * the attribution shown. Swap for a paid tile service (Mapbox, MapTiler, Stadia) before heavy
 * commercial use.
 */
export const tileUrl = (z: number, x: number, y: number, dark: boolean) =>
  `https://basemaps.cartocdn.com/${dark ? "dark_all" : "rastertiles/voyager"}/${z}/${x}/${y}.png`;
export const MAP_CREDIT = "© OpenStreetMap contributors © CARTO";

/** Web Mercator pixel position at a zoom level. */
export function project(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export interface MapLayout {
  zoom: number;
  tiles: { key: string; z: number; x: number; y: number; left: number; top: number }[];
  pins: { x: number; y: number }[];
}

/** The tiles and pin positions for a width × height map showing every point. */
export function fitMap(
  points: { lat: number; lng: number }[],
  width: number,
  height: number,
  pad = 36,
  maxZoom = 16,
): MapLayout | undefined {
  if (!points.length || width <= 0 || height <= 0) return undefined;
  // One place: close enough to see the streets around it.
  const top = points.length === 1 ? Math.min(maxZoom, 15) : maxZoom;
  for (let zoom = top; zoom >= 1; zoom--) {
    const at = points.map((p) => project(p.lat, p.lng, zoom));
    const xs = at.map((p) => p.x);
    const ys = at.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    if (zoom > 1 && (maxX - minX > width - 2 * pad || maxY - minY > height - 2 * pad)) continue;
    const left = (minX + maxX) / 2 - width / 2;
    const top = (minY + maxY) / 2 - height / 2;
    const count = 2 ** zoom;
    const tiles: MapLayout["tiles"] = [];
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
        const x = ((tx % count) + count) % count;
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          z: zoom,
          x,
          y: ty,
          left: Math.round(tx * TILE - left),
          top: Math.round(ty * TILE - top),
        });
      }
    }
    return { zoom, tiles, pins: at.map((p) => ({ x: p.x - left, y: p.y - top })) };
  }
  return undefined;
}

/** Directions in the phone's own maps app, or Google Maps elsewhere. */
export function directionsUrl(place: { lat: number; lng: number; name: string }, apple: boolean) {
  return apple
    ? `https://maps.apple.com/?daddr=${place.lat},${place.lng}&q=${encodeURIComponent(place.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
}
