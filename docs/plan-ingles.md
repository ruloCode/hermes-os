# Plan de estudios de inglés (/ingles → Plan)

2026-10-20. Pedido: analizar todas las clases de inglés registradas y armar un
plan de estudios estilo Duolingo, practicable con la tutora de voz en tiempo
real y con el gimnasio, con el progreso a la vista.

## 1 · Lo que dicen las sesiones

Se leyeron las 15 sesiones de `english_sessions` (6 clases reales con la
profesora, 48-61 min cada una, y 9 prácticas con la tutora), sus 97 errores
anotados y los 15 reportes del coach. Lo importante:

- **No es falta de reglas.** En la clase del 16-oct acertó los tres ejercicios
  de reconocimiento y explicó la regla; en conversación libre se le escapó la
  misma concordancia 5+ veces. El problema es **automatizar**, no aprender.
- **Los mismos patrones de la primera a la última sesión** (jul → oct): el
  reporte de cada sesión marca "RECURRENTE" en los mismos cinco o seis.
- Dos clases no tienen errores anotados (16-oct: no entró su voz; 07-oct:
  diarización al revés). Son clases **sin datos**, no clases perfectas.

Errores clasificados por patrón (clasificador de `english-plan.ts`, 84 de 97
reconocidos; el resto es ruido del STT o casos de una sola vez):

| Patrón | Errores | Sesiones | Ejemplos reales |
|---|---|---|---|
| Pasado en historias | 18 | 7 | «then I share», «the metrics show», «I roll up the deployment» |
| Orden y forma del verbo | 17 | 6 | «I need that you», «avoid to talk», «Never I have seen» |
| Artículos, plurales y contables | 16 | 6 | «the three option», «too many confidence», «access to the healthcare» |
| La palabra exacta | 15 | 7 | «personal grow», «I think different», «presenting my corners» |
| La -s de tercera persona | 7 | 4 | «it's handle», «anyone have», «someone who listen» |
| Verbo + preposición | 6 | 5 | «working in this feature», «depends of», «responding a question» |
| Sujeto siempre | 5 | 2 | «for me is radical», «I think is enough», «it's breakfast is» |

Más el patrón de entrevista, que no sale de errores sueltos sino de los
reportes: «too long, not concise enough», cerrar con «so yeah», abrir todo con
«Yeah,», pasarse al español al trabarse.

El orden de la ruta pondera frecuencia y costo en una entrevista: el pasado
primero (lo que más repiten los reportes), después -s, sujeto y preposiciones
(rápidos de automatizar y muy visibles), luego artículos, forma de la palabra y
estructura, y la entrevista al final como unidad que integra todo.

## 2 · Cómo funciona

**8 unidades × 5 lecciones** (`packages/shared/src/english-plan.ts`, puro):

1. **Regla**: por qué esta unidad (con «apareció en N de tus M sesiones»), la
   regla en 4-5 líneas, frases modelo para escuchar, y un quiz de 4-5 preguntas
   «¿cuál suena bien?» hecho con **tus errores reales** de ese patrón (con la
   clase de donde salió cada uno). Si no alcanzan, completa con ejemplos del
   temario. Aprueba con 70 %.
2. **Gimnasio 1**: una pregunta en inglés + estructuras a usar → grabas (misma
   grabadora del gimnasio, Espacio) → STT de juntas → `evaluateDrill` (Agent
   SDK + una tool, `HERMES_GYM_MODEL`, sin razonamiento extendido, ~19 s). El 70 %
   de la nota es EL PATRÓN; devuelve errores, estructuras usadas, «Dilo así» y
   un consejo. Aprueba con 70.
3. **Tutora**: llamada de voz en modo lección (abajo). Cuenta al guardarse una
   práctica de 3+ minutos.
4. **Gimnasio 2**: otra situación, mismo patrón.
5. **Prueba**: respuesta larga (75-90 s) que exige el patrón de punta a punta.
   Aprueba con 80. **Siempre abierta**: pasarla da la unidad por hecha (el test
   de salto de Duolingo), así no hay que moler lo que ya dominas.

**Progreso** (todo real): XP (regla 10 · gimnasio 15 · tutora 25 · prueba 30;
repetir aprobada 5), meta diaria de 30 XP, racha de días con una lección
aprobada, los últimos 14 días, y **«En tus clases»**: errores por patrón en las
últimas clases con audio, que es la métrica que importa (el XP mide esfuerzo;
esto mide si sirve). Cada lección aprobada (salvo la de tutora, que ya lo hace)
marca el hábito «Práctica de inglés».

**Lección con la tutora**: `useVoiceConnect.switchToTutor({ lessonId })` →
`POST /english/plan/tutor` deja la marca (`pending-tutor.json`, vence a las 3 h)
y devuelve el `{{practice_context}}` de la lección (meta, regla, tus errores
reales, frases modelo, «corrige solo este patrón») + un primer turno que
InglesView manda con `sendUserMessage` al conectar (el saludo de la tutora es
fijo). La regla 12 del prompt de la tutora dice que una lección manda sobre la
charla libre (republicado con `pnpm setup:elevenlabs --tutor`). Al colgar,
`saveEnglishSession` → `notePracticeSaved` cierra la lección con ESA sesión si
no es una clase, duró ≥3 min y empezó después de abrir la lección. Funciona
igual si la práctica se guarda desde el móvil.

## 3 · Piezas

- `packages/shared/src/english-plan.ts`: temario, `planView` (qué se abre),
  `planXp`, `planStreak`, `classifyError`/`patternHits`, `classTrend`,
  `quizItemsFor`, `tutorLessonBlock`.
- `apps/agent/src/english/plan-store.ts` (intentos en
  `~/.hermes-os/english-plan/attempts.jsonl`, sin migración),
  `plan-drill.ts` (evaluador), `plan-routes.ts` (`GET /english/plan` · `POST
  /english/plan/quiz` · `POST /english/plan/drill` · `POST|DELETE
  /english/plan/tutor`), tests en `plan.test.ts`.
- Web: `/ingles` abre en la pestaña **Plan** (Sesiones = lo de antes).
  `components/ingles/plan/` (`PlanTab` → `PlanPath` + `PlanRail`; `LessonPlayer`
  → `QuizLesson` / `DrillLesson` / `TutorLesson`), `hooks/useEnglishPlan.ts`,
  `lib/english-lesson.ts`. ⌘K «Plan de inglés».

## 4 · Diseño

Matiz no tiene la ruta de Duolingo: su corpus es de sitios de marketing y la
app pide login. Se tomó de la app que todos conocen la gramática (zigzag,
nodo lleno = lo que toca, lección a pantalla completa, quiz de dos opciones
con explicación inmediata, barra de progreso por pregunta) y del timeline
vertical de inngest.com (`inngest.com#5` en Matiz) la cabecera de cada tramo con
su estado a la derecha. Todo dentro de Grafito (v5): el acento solo en la
lección actual y en los botones; verde = hecho; nada de colores de categoría.
La crítica de Matiz contra esa referencia no encontró problemas de contraste;
el resto de sus sugerencias (titular de 72 px, footer) son de landing y no
aplican a una vista de app.

## 5 · Pendiente

- Probar una lección de voz completa con la tutora (el flujo de contexto y
  cierre está probado por API y tests, pero falta una llamada real).
- Móvil y Hermes Phone: el plan vive solo en el dashboard; la lección de voz se
  cierra igual si la práctica se guarda desde el móvil.
- Re-evaluar el orden de las unidades cuando haya más clases con audio: con
  tres clases medidas, «sube/baja» es una señal débil.
