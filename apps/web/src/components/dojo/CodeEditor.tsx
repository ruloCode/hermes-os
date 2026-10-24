"use client";

// EDITOR DEL DOJO: CodeMirror 6 con Python, armado a mano en vez de basicSetup
// porque basicSetup trae autocompletado por palabras — y aquí la idea es que
// TECLEES la lógica. Lo que sí trae: números de línea, deshacer, sangría de 4
// espacios, cierre de paréntesis/comillas, resaltado de pares y Tab para
// sangrar. Vim es opcional (se carga solo si lo prendes).
//
// Colores SOLO por tokens del tema (var(--color-*)): el editor sigue claro/
// oscuro sin re-montarse. ⌘↵ prueba los ejemplos y ⌘⇧↵ envía, con prioridad
// sobre cualquier otro atajo del editor.

import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--color-accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--color-chart-2)" },
  { tag: [t.number, t.bool, t.null], color: "var(--color-chart-3)" },
  { tag: t.comment, color: "var(--color-text-faint)", fontStyle: "italic" },
  { tag: [t.function(t.definition(t.variableName)), t.function(t.variableName)], color: "var(--color-chart-4)" },
  { tag: t.className, color: "var(--color-chart-5)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--color-text-dim)" },
]);

function theme(fontSize: number, fill: boolean): Extension {
  return EditorView.theme({
    "&": {
      color: "var(--color-text)",
      backgroundColor: "transparent",
      fontSize: `${fontSize}px`,
      height: fill ? "100%" : "auto",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overflow: "auto" },
    ".cm-content": { caretColor: "var(--color-accent)", padding: "10px 0" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--color-text-faint)",
      border: "none",
      paddingLeft: "6px",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 4px", minWidth: "2.2em" },
    ".cm-activeLine": { backgroundColor: "var(--color-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text-dim)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      { backgroundColor: "color-mix(in srgb, var(--color-accent) 26%, transparent)" },
    ".cm-matchingBracket": {
      backgroundColor: "var(--color-selected)",
      color: "inherit",
      outline: "1px solid var(--color-line-2)",
    },
    ".cm-dojo-error": { backgroundColor: "color-mix(in srgb, var(--color-red) 14%, transparent)" },
    ".cm-dojo-active": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
      boxShadow: "inset 2px 0 0 var(--color-accent)",
    },
    // Vim: bloque de cursor y la línea de comandos con los colores del tema.
    ".cm-fat-cursor": { backgroundColor: "color-mix(in srgb, var(--color-accent) 55%, transparent)" },
    ".cm-vim-panel": { backgroundColor: "var(--color-panel-2)", color: "var(--color-text)", fontFamily: "var(--font-mono)" },
  });
}

function lineMarkExt(view: EditorView | null, line: number | null, cls: string): Extension {
  if (!view || !line || line < 1 || line > view.state.doc.lines) return [];
  const at = view.state.doc.line(line).from;
  return EditorView.decorations.of(Decoration.set([Decoration.line({ class: cls }).range(at)]));
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  fontSize = 15,
  fill = false,
  vim = false,
  errorLine = null,
  activeLine = null,
  onRun,
  onSubmit,
  autoFocus = false,
  ariaLabel = "Editor de Python",
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  fontSize?: number;
  /** Ocupa el alto del contenedor (el editor del problema) en vez de medir su contenido. */
  fill?: boolean;
  vim?: boolean;
  /** Línea a marcar en rojo (la del último error). */
  errorLine?: number | null;
  /** Línea que se está ejecutando en el modo en vivo. */
  activeLine?: number | null;
  /** ⌘↵ */
  onRun?: () => void;
  /** ⌘⇧↵ */
  onSubmit?: () => void;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onRun, onSubmit });
  cb.current = { onChange, onRun, onSubmit };
  const comps = useRef({
    readOnly: new Compartment(),
    theme: new Compartment(),
    vim: new Compartment(),
    error: new Compartment(),
    active: new Compartment(),
  });

  // Montaje único; lo que cambia después entra por compartimentos.
  useEffect(() => {
    const c = comps.current;
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          c.vim.of([]),
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: () => (cb.current.onRun?.(), true) },
              { key: "Mod-Shift-Enter", run: () => (cb.current.onSubmit?.(), true) },
            ]),
          ),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          python(),
          syntaxHighlighting(highlight),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          c.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          c.theme.of(theme(fontSize, fill)),
          c.error.of([]),
          c.active.of([]),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "false", autocapitalize: "off" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Valor de afuera (reiniciar, cambiar de problema): solo si difiere, así lo
  // que tecleas no vuelve como "cambio externo" y el cursor no salta.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: comps.current.readOnly.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: comps.current.theme.reconfigure(theme(fontSize, fill)) });
  }, [fontSize, fill]);

  useEffect(() => {
    const view = viewRef.current;
    view?.dispatch({ effects: comps.current.error.reconfigure(lineMarkExt(view, errorLine, "cm-dojo-error")) });
  }, [errorLine]);

  useEffect(() => {
    const view = viewRef.current;
    view?.dispatch({ effects: comps.current.active.reconfigure(lineMarkExt(view, activeLine, "cm-dojo-active")) });
  }, [activeLine]);

  useEffect(() => {
    let cancelled = false;
    if (!vim) {
      viewRef.current?.dispatch({ effects: comps.current.vim.reconfigure([]) });
      return;
    }
    void import("@replit/codemirror-vim").then(({ vim: vimExt }) => {
      if (!cancelled) viewRef.current?.dispatch({ effects: comps.current.vim.reconfigure(vimExt()) });
    });
    return () => {
      cancelled = true;
    };
  }, [vim]);

  return <div ref={hostRef} className={fill ? "h-full min-h-0" : ""} />;
}
