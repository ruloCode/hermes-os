/**
 * Script inline que corre ANTES del primer paint (va en <head> del layout):
 * lee la preferencia guardada y estampa data-theme en <html>. Sin esto la
 * página cargaría en oscuro y saltaría a claro al hidratar.
 *
 * Es texto plano a propósito (no un módulo): el layout es un Server
 * Component y lo inyecta con dangerouslySetInnerHTML.
 */
export const THEME_STORAGE_KEY = "hermes-theme";

/** Marca de sesión: la cortina de arranque ya se vio en esta pestaña. */
export const BOOTED_SESSION_KEY = "hermes-booted";

// También estampa `data-booted` si esta pestaña ya vio la cortina de arranque:
// el CSS la oculta ANTES del primer paint (sin destello) y BootGate la desmonta
// al hidratar. La cortina es para abrir Hermes, no para cada recarga.
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var k="${THEME_STORAGE_KEY}";var p=localStorage.getItem(k);var m=window.matchMedia("(prefers-color-scheme: light)").matches;var t=(p==="light"||p==="dark")?p:(m?"light":"dark");d.setAttribute("data-theme",t);}catch(e){d.setAttribute("data-theme","dark");}try{if(sessionStorage.getItem("${BOOTED_SESSION_KEY}"))d.setAttribute("data-booted","");}catch(e){}})();`;
