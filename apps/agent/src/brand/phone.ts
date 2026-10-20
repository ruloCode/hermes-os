// Lo que Hermes Phone recibe de la marca (`packages/shared/src/brand.ts`).
//
// Función PURA: devuelve { ruta relativa al repo del teléfono → contenido }.
// La escribe `pnpm brand:sync` y un test la compara contra lo que hay en el
// disco del teléfono — así "el teléfono sigue la marca" es un contrato que
// falla en voz alta, no una promesa.

import {
  BRAND_COLOR_KEYS,
  BRAND_DARK,
  BRAND_LIGHT,
  BRAND_MARK,
  BRAND_RADIUS,
  BRAND_TYPE,
  parseBrandColor,
  toAndroidHex,
  toArgbHex,
  type BrandColorKey,
  type BrandPalette,
} from "@hermes/shared";

const HEADER =
  "GENERADO por `pnpm brand:sync` desde hermes-os/packages/shared/src/brand.ts — no editar a mano.";

/** `accent-solid` → `accentSolid`, `panel-2` → `panel2`. */
export function kotlinName(key: BrandColorKey): string {
  return key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function palette(name: string, p: BrandPalette): string {
  const args = BRAND_COLOR_KEYS.map(
    (k) => `        ${kotlinName(k)} = Color(${toArgbHex(parseBrandColor(p[k]))}),`,
  ).join("\n");
  return `    val ${name} = BrandPalette(\n${args}\n    )`;
}

function brandKt(): string {
  const fields = BRAND_COLOR_KEYS.map((k) => `    val ${kotlinName(k)}: Color,`).join("\n");
  const s = BRAND_TYPE.scale;
  return `// ${HEADER}
package os.hermes.phone.ui

import androidx.compose.ui.graphics.Color

/** Una paleta Grafito completa (los mismos nombres que los tokens de la web). */
class BrandPalette(
${fields}
)

/** La marca de Hermes, idéntica a la del dashboard. */
object Brand {
    const val NAME = "Hermes"

${palette("Dark", BRAND_DARK)}

${palette("Light", BRAND_LIGHT)}

    /** Hoja índigo con una "H" cuyo travesaño sube (viewBox ${BRAND_MARK.viewBox}). */
    object Mark {
        const val VIEWBOX = ${BRAND_MARK.viewBox}f
        const val CORNER = ${BRAND_MARK.cornerRadius}f
        const val PATH = "${BRAND_MARK.path}"
        const val STROKE = ${BRAND_MARK.strokeWidth}f
    }

    /** Escala tipográfica en sp (${BRAND_TYPE.sans} + ${BRAND_TYPE.mono}). */
    object TypeScale {
        const val LABEL = ${s.label}
        const val SUPPORT = ${s.support}
        const val BODY = ${s.body}
        const val SECTION = ${s.section}
        const val TITLE = ${s.title}
        const val HERO = ${s.hero}
    }

    /** Radios en dp: controles · tarjetas · superficies grandes · hojas. */
    object Radii {
        const val CONTROL = ${BRAND_RADIUS.control}
        const val CARD = ${BRAND_RADIUS.card}
        const val SURFACE = ${BRAND_RADIUS.surface}
        const val SHEET = ${BRAND_RADIUS.sheet}
    }
}
`;
}

function color(key: BrandColorKey, p: BrandPalette = BRAND_DARK): string {
  return toAndroidHex(parseBrandColor(p[key]));
}

/**
 * Icono adaptativo: el fondo es el índigo sólido y el primer plano la "H".
 * El lienzo de 24 de la marca se mapea a los 72 dp visibles del icono de 108
 * (escala 3, desplazamiento 18): la "H" queda dentro de la zona segura de 66.
 */
function launcherForeground(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="18" android:translateY="18" android:scaleX="3" android:scaleY="3">
        <path
            android:pathData="${BRAND_MARK.path}"
            android:strokeColor="${color("on-accent")}"
            android:strokeWidth="${BRAND_MARK.strokeWidth}"
            android:strokeLineCap="round" />
    </group>
</vector>
`;
}

/** La marca completa (hoja + H) para usar dentro de la app y en notificaciones grandes. */
function markDrawable(): string {
  const v = BRAND_MARK.viewBox;
  const r = BRAND_MARK.cornerRadius;
  const rect = `M${r},0h${v - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${v - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${v - 2 * r}a${r},${r} 0 0 1 -${r},-${r}v-${v - 2 * r}a${r},${r} 0 0 1 ${r},-${r}z`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="${v}" android:viewportHeight="${v}">
    <path android:fillColor="${color("accent-solid")}" android:pathData="${rect}" />
    <path
        android:pathData="${BRAND_MARK.path}"
        android:strokeColor="${color("on-accent")}"
        android:strokeWidth="${BRAND_MARK.strokeWidth}"
        android:strokeLineCap="round" />
</vector>
`;
}

/** Icono de notificación (la barra lo pinta de un color: solo la "H", sin la hoja). */
function notificationIcon(): string {
  const v = BRAND_MARK.viewBox;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="${v}" android:viewportHeight="${v}">
    <path
        android:pathData="${BRAND_MARK.path}"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="${BRAND_MARK.strokeWidth}"
        android:strokeLineCap="round" />
</vector>
`;
}

function adaptiveIcon(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/brand_icon_bg" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;
}

/** Colores que necesita el XML (ventana antes de que Compose pinte, fondo del icono). */
function colorsXml(): string {
  const rows: Array<[string, string]> = [
    ["brand_bg", color("bg")],
    ["brand_chrome", color("chrome")],
    ["brand_panel", color("panel")],
    ["brand_text", color("text")],
    ["brand_accent", color("accent")],
    ["brand_icon_bg", color("accent-solid")],
    ["brand_bg_light", color("bg", BRAND_LIGHT)],
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<resources>
${rows.map(([n, v]) => `    <color name="${n}">${v}</color>`).join("\n")}
</resources>
`;
}

/** Todos los archivos que la marca escribe en el repo del teléfono. */
export function renderPhoneBrand(): Record<string, string> {
  const res = "app/src/main/res";
  return {
    "app/src/main/java/os/hermes/phone/ui/Brand.kt": brandKt(),
    [`${res}/values/brand.xml`]: colorsXml(),
    [`${res}/drawable/ic_launcher_foreground.xml`]: launcherForeground(),
    [`${res}/drawable/ic_hermes_mark.xml`]: markDrawable(),
    [`${res}/drawable/ic_stat_hermes.xml`]: notificationIcon(),
    [`${res}/mipmap-anydpi-v26/ic_launcher.xml`]: adaptiveIcon(),
  };
}
