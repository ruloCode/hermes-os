import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Cliente con service role (solo server-side). Si no hay credenciales,
// el server sigue funcionando en modo degradado (sin memoria persistente).
let client: SupabaseClient | null = null;

if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
} else {
  console.warn(
    "[hermes] Supabase no configurado — memorias y presencia deshabilitadas. " +
      "Completa NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env",
  );
}

export const supabase = client;
export const hasSupabase = () => client !== null;
