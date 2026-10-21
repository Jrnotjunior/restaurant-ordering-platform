# Central Map Service

**Status:** Shared map is active and has passed user-reported live checks for map rendering, accurate address search, delivery-fee calculation, and selection from the restaurant's custom-domain checkout. The legacy build-time token configuration has been retired. Repository review found no separate legacy map UI implementation in the current source tree; the listed map UI and location modules are dependencies of the shared map.

## Architecture

Web2Table serves a central map page at:

- `https://app.web2table.io/maps.html`

The main tenant app embeds this page in an iframe from `MapboxDeliveryLocationPicker`. The map page is a separate Vite HTML entry, so the Mapbox SDK and map UI are loaded within the central origin rather than directly on each restaurant's custom domain.

The platform continues to use one centrally managed Mapbox account and token. Tenant owners do not configure or pay for separate Mapbox accounts.

### Selection and message contract

1. The tenant page accepts messages only from the exact central map origin and the expected iframe window.
2. The map page accepts initialization only from its parent window, validates that the parent origin is HTTPS, and resolves the parent hostname against `resolve_restaurant_by_domain` before loading Mapbox. The temporary `jrnotjunior.github.io` manual-test origin is separately scoped to the configured demo slug.
3. The map page fetches the public token from `mapbox-public-config` at runtime. The token is not compiled into or committed with the static JavaScript bundle.
4. Selected addresses and coordinate changes are sent back with `postMessage` to the exact validated parent origin. The tenant page validates the message source, origin, request id, and coordinate ranges. Parent selection errors are acknowledged back to the iframe.
5. The Edge Function returns a token only for the configured central-service Origin. CORS is not considered authentication; this is a public Mapbox token, so its own scopes and URL restrictions remain essential.

## Supabase Edge Function configuration

Function: `mapbox-public-config` (deployed to the production Supabase project).

Required Edge Function secret:

- `MAPBOX_PUBLIC_TOKEN`: a newly generated/restricted Mapbox **public** token beginning `pk.`.

Optional Edge Function secret:

- `MAP_SERVICE_ORIGIN`: defaults to `https://app.web2table.io`. Only change it when the central map page is intentionally moved to a different central origin.

Do **not** set an `sk.` secret token as `MAPBOX_PUBLIC_TOKEN`. The token is returned to a browser at runtime by design, because Mapbox GL JS is client-side. Only use public scopes required for map rendering and search, and restrict its allowed URL to `https://app.web2table.io`. Tenant-specific restaurant origins do not need to be added to that token.

Set the secret in the Supabase Dashboard for the production project under **Edge Functions → Secrets** (or the project's function secrets settings), then redeploy/restart the function if the dashboard prompts you. This repository's GitHub Actions no longer needs `VITE_MAPBOX_PUBLIC_TOKEN`; it builds the app without embedding that token in files committed to `hostinger-deploy`.

## Deployment and verification checklist

- [x] Build a separate `maps.html` entry with the central Mapbox UI.
- [x] Route tenant delivery and restaurant-location pickers through the central iframe.
- [x] Validate message origin/source and delivery-address payloads.
- [x] Validate parent host against active tenant-domain resolution, with the known GitHub Pages test exception.
- [x] Deploy the runtime config Edge Function with JWT verification disabled because it serves public configuration; the handler enforces an exact Origin check.
- [x] Remove `VITE_MAPBOX_PUBLIC_TOKEN` from the repository's build-time environment configuration.
- [x] Production `MAPBOX_PUBLIC_TOKEN` is configured as a public `pk.` token (confirmed by the project owner).
- [ ] Verify Mapbox URL restrictions for `https://app.web2table.io` and public scopes for map style/tiles/fonts and geocoding search.
- [x] Hostinger and GitHub Pages workflows completed successfully on commit `7963664`, and the published `hostinger-deploy` tree contains `maps.html` plus separate app/map bundles.
- [x] Removed `VITE_MAPBOX_PUBLIC_TOKEN` from all build workflow environment mappings; the token is retrieved at runtime from the Supabase function.
- [x] Live browser smoke tests reported by the project owner: central map loads, address search is accurate, delivery fee calculates correctly, and custom-domain checkout location selection works.
- [x] Real checkout flow tested from a registered restaurant custom domain (reported by the project owner). 
- [ ] Verify Mapbox public token scopes and allowed-URL restriction for `https://app.web2table.io`.

## Legacy implementation and service boundaries

- The old `VITE_MAPBOX_PUBLIC_TOKEN` build-time configuration is retired. Do not restore it.
- `src/components/MapboxDeliveryLocationPicker.tsx` is the tenant-side iframe adapter, `src/maps/MapServiceApp.tsx` is the shared iframe app, and `src/components/MapboxLocationPickerUi.tsx` is the shared map UI. `src/modules/location/locationService.ts` supplies geocoding helpers used by that shared UI. These are not legacy duplicates and must not be deleted as part of the migration.
- `supabase/functions/calculate-delivery-route/index.ts` is a separate server-side delivery-pricing dependency. It uses `MAPBOX_DIRECTIONS_API_TOKEN` to request driving distance and calculates a quote. Keep it server-side; do not expose a directions credential in the browser. It is not a second map UI and should not be removed just to centralize map rendering.
- The repository's current map-related source files are all referenced by the shared architecture; no separate old map UI file was identified in the current source tree. Remove only a proven-unused legacy reference after checking all call sites.

## Future dedicated subdomain

This first version uses `app.web2table.io/maps.html` as the shared origin so no additional DNS or Hostinger site mapping is required before activation. If Web2Table later creates a dedicated `maps.web2table.io` hosting origin, set `VITE_MAP_SERVICE_URL=https://maps.web2table.io/maps.html`, set the Edge Function secret `MAP_SERVICE_ORIGIN=https://maps.web2table.io`, update the token URL restriction to that origin, and point DNS/Hostinger at the central map build. Tenant owners still will not need their own tokens.

## Important security note

A public token is visible to browser users even when delivered from an Edge Function. Runtime delivery prevents the token value from being stored in compiled GitHub deployment files; it does **not** make the token secret. Restrict its scopes and URL, monitor Mapbox usage, and never expose a token with secret scopes. Mapbox describes URL restrictions as a best-effort mitigation and documents the 100-URL restriction limit and lack of wildcard support in its [token management documentation](https://docs.mapbox.com/accounts/guides/tokens/).
