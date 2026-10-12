-- Restore the storefront hero's original dark slate default.
-- Update only the previous white default; preserve other explicitly chosen hero colors.
update public.restaurant_website_customizations
set theme = jsonb_set(theme, '{colors,hero}', '"#0f172a"'::jsonb, true)
where theme #>> '{colors,hero}' = '#ffffff';

alter table public.restaurant_website_customizations
  alter column theme set default '{
    "fontHeading":"Manrope",
    "fontBody":"Inter",
    "fontUi":"Inter",
    "borderRadius":"medium",
    "buttonStyle":"filled",
    "colors":{
      "primary":"#111827",
      "primaryHover":"#1f2937",
      "primaryText":"#ffffff",
      "secondary":"#f3f4f6",
      "secondaryText":"#111827",
      "background":"#ffffff",
      "surface":"#ffffff",
      "text":"#111827",
      "muted":"#6b7280",
      "border":"#e5e7eb",
      "success":"#15803d",
      "warning":"#b45309",
      "error":"#b91c1c",
      "hero":"#0f172a"
    }
  }'::jsonb;
