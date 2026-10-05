import { useEffect, useRef } from 'react';
import { Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

export type DeliveryCoordinate = { latitude: number; longitude: number };

type Props = {
  center: DeliveryCoordinate;
  marker: DeliveryCoordinate | null;
  radiusKm: number;
  interactive?: boolean;
  onMarkerChange?: (coordinate: DeliveryCoordinate) => void;
  height?: number;
};

function circleFeature(center: DeliveryCoordinate, radiusKm: number) {
  const points: Array<[number, number]> = [];
  const earthRadiusKm = 6371;
  const angularDistance = radiusKm / earthRadiusKm;
  const lat = center.latitude * Math.PI / 180;
  const lon = center.longitude * Math.PI / 180;

  for (let i = 0; i <= 96; i += 1) {
    const bearing = i / 96 * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) +
      Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLon = lon + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
      Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat),
    );
    points.push([pointLon * 180 / Math.PI, pointLat * 180 / Math.PI]);
  }

  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [points] },
    properties: {},
  };
}

export function DeliveryCoverageMap({ center, marker, radiusKm, interactive = false, onMarkerChange, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onMarkerChangeRef = useRef(onMarkerChange);
  onMarkerChangeRef.current = onMarkerChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [center.longitude, center.latitude],
      zoom: Math.max(11, Math.min(15, 13 - Math.log2(Math.max(radiusKm, 1) / 2))),
      attributionControl: true,
    });

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('delivery-radius', {
        type: 'geojson',
        data: circleFeature(center, Math.max(radiusKm, 0.1)),
      });
      map.addLayer({
        id: 'delivery-radius-fill',
        type: 'fill',
        source: 'delivery-radius',
        paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: 'delivery-radius-outline',
        type: 'line',
        source: 'delivery-radius',
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      });

      if (interactive) {
        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', (event) => {
          onMarkerChangeRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });
      }
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const source = map.getSource('delivery-radius');
      if (source && 'setData' in source) {
        source.setData(circleFeature(center, Math.max(radiusKm, 0.1)) as GeoJSON.Feature<GeoJSON.Polygon>);
      }
    };

    if (map.isStyleLoaded()) update();
    else map.once('load', update);
    map.setCenter([center.longitude, center.latitude]);
  }, [center.latitude, center.longitude, radiusKm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRef.current?.remove();
    markerRef.current = null;

    if (!marker) return;

    const markerElement = document.createElement('div');
    markerElement.className = 'delivery-map-marker';
    markerElement.innerHTML = '<span aria-hidden="true">●</span>';
    markerElement.title = interactive ? 'Drag or click the map to move the location' : 'Selected delivery location';

    const mapMarker = new Marker({
      element: markerElement,
      draggable: interactive,
      color: '#111827',
    }).setLngLat([marker.longitude, marker.latitude]).addTo(map);

    if (interactive) {
      mapMarker.on('dragend', () => {
        const lngLat = mapMarker.getLngLat();
        onMarkerChangeRef.current?.({ latitude: lngLat.lat, longitude: lngLat.lng });
      });
    }

    markerRef.current = mapMarker;
  }, [marker?.latitude, marker?.longitude, interactive]);

  return <div className="delivery-map" ref={containerRef} style={{ height }} aria-label={interactive ? 'Interactive delivery coverage map' : 'Delivery coverage map'} />;
}
