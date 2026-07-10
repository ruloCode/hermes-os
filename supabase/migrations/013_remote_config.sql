-- Hermes OS · migración 013 — remote_config (descubrimiento del túnel)
-- La app móvil necesita encontrar el agente desde cualquier red. El túnel
-- cloudflared (quick tunnel) cambia de URL en cada arranque → el servicio
-- com.hermes-os.tunnel publica aquí la URL vigente y el móvil la lee tras
-- hacer login (RLS: solo usuarios autenticados; escribe solo el service role).

create table if not exists remote_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table remote_config enable row level security;

-- Lectura para usuarios logueados (email+contraseña). Sin policy de escritura:
-- solo el service role (el script del túnel en la Mac) puede escribir.
drop policy if exists remote_config_read_authenticated on remote_config;
create policy remote_config_read_authenticated on remote_config
  for select to authenticated using (true);
