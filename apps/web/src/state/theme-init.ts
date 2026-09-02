/**
 * Script inline que corre ANTES del primer paint (va en <head> del layout):
 * lee la preferencia guardada y estampa data-theme en <html>. Sin esto la
 * página cargaría en oscuro y saltaría a claro al hidratar.
 *
 * Es texto plano a propósito (no un módulo): el layout es un Server
 * Component y lo inyecta con dangerouslySetInnerHTML.
 */
export const THEME_STORAGE_KEY = "hermes-theme";

export const THEME_INIT_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var p=localStorage.getItem(k);var m=window.matchMedia("(prefers-color-scheme: light)").matches;var t=(p==="light"||p==="dark")?p:(m?"light":"dark");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
