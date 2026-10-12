-- Store each restaurant's initial hero color in its persisted theme rather than
-- relying on a frontend fallback. Preserve any hero color already configured.
update public.restaurant_website_customizations
set theme = jsonb_set(
  theme,
  '{colors,hero}',
  coalesce(theme #> '{colors,hero}', theme #> '{colors,surface}', '"#ffffff"'::jsonb),
  true
)
where theme #> '{colors,hero}' is null;

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
      "hero":"#ffffff"
    }
  }'::jsonb;
