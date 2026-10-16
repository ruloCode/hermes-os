// Primer import de index.js: el handler global tiene que estar puesto ANTES de
// que se evalúe cualquier otro módulo, o un error al cargar cerraría la app.
import { installCrashGuard } from "./crash";

installCrashGuard();
