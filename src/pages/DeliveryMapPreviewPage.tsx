import { useState } from 'react';
import { DeliveryCoverageMap, type DeliveryCoordinate } from '../components/DeliveryCoverageMap';

const sampleRestaurant: DeliveryCoordinate = {
  latitude: 14.7011,
  longitude: 120.9830,
};

export function DeliveryMapPreviewPage() {
  const [radiusKm, setRadiusKm] = useState(5);
  const [marker, setMarker] = useState<DeliveryCoordinate>({
    latitude: 14.705,
    longitude: 120.99,
  });

  return (
    <main style={{ minHeight: '100vh', padding: '32px 20px', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 'min(1100px, 100%)', margin: '0 auto' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#64748b' }}>Web2Table experiment</p>
        <h1 style={{ margin: '8px 0 8px', fontSize: 30 }}>Google Maps delivery coverage preview</h1>
        <p style={{ margin: '0 0 24px', color: '#64748b' }}>
          This is a frontend-only preview. It does not read or change Supabase delivery settings.
        </p>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20, alignItems: 'start' }}>
          <div style={{ overflow: 'hidden', border: '1px solid #dbe2ea', borderRadius: 16, background: '#fff' }}>
            <DeliveryCoverageMap
              center={sampleRestaurant}
              marker={marker}
              radiusKm={radiusKm}
              interactive
              onMarkerChange={setMarker}
              height={520}
            />
          </div>

          <aside style={{ display: 'grid', gap: 16, padding: 20, border: '1px solid #dbe2ea', borderRadius: 16, background: '#fff' }}>
            <div>
              <strong>Restaurant</strong>
              <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13 }}>Sample location for the preview</p>
            </div>
            <label style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
              Delivery radius
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={radiusKm}
                onChange={(event) => setRadiusKm(Number(event.target.value))}
              />
              <span style={{ fontSize: 24 }}>{radiusKm.toFixed(1)} km</span>
            </label>
            <div style={{ padding: 12, borderRadius: 10, background: '#f8fafc', fontSize: 13, lineHeight: 1.5 }}>
              <strong>Test the map</strong>
              <p style={{ margin: '6px 0 0', color: '#64748b' }}>
                Click anywhere on the map or drag the pin. The blue circle represents the restaurant delivery radius.
              </p>
            </div>
            <a className="button button-secondary" href="#menu">Back to menu</a>
          </aside>
        </section>
      </div>
    </main>
  );
}
