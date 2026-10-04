alter table public.restaurant_website_customizations
  add column if not exists storefront jsonb not null default '{
    "hero":{
      "enabled":true,
      "eyebrow":"Our menu",
      "title":"Choose what you’re craving.",
      "description":"Browse available items and add your favorites to your order.",
      "imageUrl":"",
      "primaryButtonLabel":"Order now",
      "primaryButtonHref":"#menu",
      "secondaryButtonLabel":"",
      "secondaryButtonHref":""
    },
    "sections":{
      "categories":true,
      "about":false,
      "location":true,
      "hours":true,
      "contact":true,
      "social":true
    },
    "footer":{
      "enabled":true,
      "text":""
    }
  }'::jsonb;
