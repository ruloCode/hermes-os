# Kit de Anatomy (vendorizado)

Copiado de https://github.com/wheresryan22/anatomy (MIT, ver LICENSE) en el commit
`1482e8469b0a9e0d8cc18ea2740a01423d29ae80` (2026-10-18): `kit/iso-kit.ts`, `kit/iso.css`,
`kit/react/draw.tsx` y `kit/react/live.tsx`, sin cambios (los imports ya eran relativos).

Lo usan las máquinas del Dojo (`components/dojo/figures/`): cada concepto se explica
construyendo un objeto físico cuyo funcionamiento ES la idea. Para actualizar, volver a
copiar los cuatro archivos y correr `pnpm --filter @hermes/web typecheck`.
