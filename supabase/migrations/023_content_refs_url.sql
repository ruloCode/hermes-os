-- Hermes OS · migración 023 — Link navegable en las referencias del radar
--
-- El radar guardaba la fuente como texto suelto ("OutlierKit · Miraflow") sin
-- forma de VOLVER al material. `url` es el enlace canónico de la referencia:
-- con un link de YouTube la UI deriva la miniatura (i.ytimg.com/vi/<id>) y el
-- clic abre el video — el radar pasa de lista de texto a swipe file navegable
-- (patrones Mobbin: YouTube Your clips · Pinterest/Patreon pegar-link).
-- El agente resuelve título/canal reales vía oEmbed al guardar solo-link.

alter table content_refs
  add column if not exists url text;
