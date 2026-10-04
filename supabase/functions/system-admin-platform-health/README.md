# Platform Health Edge Function

This function is read-only. It is called by authenticated System Administrators and checks:

- Hostinger production web app availability
- Supabase project health
- PayMongo API reachability
- recent Supabase error activity
- AI diagnosis through OpenAI

## Server-side secrets

Configure these in the Supabase Edge Function environment:

- `SUPABASE_PROJECT_REF` — the 20-character Supabase project ref
- `SUPABASE_MANAGEMENT_API_TOKEN` — a scoped Supabase Management API token with project health/log read access
- `HOSTINGER_WEBAPP_URL` — production Web2Table URL hosted on Hostinger
- `PAYMONGO_SECRET_KEY` — PayMongo secret key for read-only API health checks
- `OPENAI_API_KEY` — OpenAI API key for AI diagnosis
- Optional: `OPENAI_HEALTH_MODEL` — defaults to `gpt-4.1-mini`

Never put these values in the System Admin React application.

The function does not make payments, modify Supabase configuration, modify data, or automatically remediate incidents.
