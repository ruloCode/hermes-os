/**
 * Descarga de texto generado en el browser. Se hace por Blob (y no con un
 * <a href> directo al agente) porque los endpoints van con Bearer: el fetch
 * lleva la credencial y así un 404 se muestra en la UI en vez de sacar al
 * usuario del dashboard a una página de error.
 */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari necesita que la URL siga viva un tick después del click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
