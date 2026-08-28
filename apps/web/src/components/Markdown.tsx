"use client";

import { createContext, type ReactNode, useContext } from "react";
import { useDocViewer } from "./DocViewer";

/**
 * Renderizador de markdown mínimo y SIN dependencias. Construye nodos React
 * (no HTML crudo) → seguro por construcción, sin riesgo de inyección. Cubre lo
 * típico de un reporte: títulos, listas (ordenadas/no), código en bloque e
 * inline, citas, separadores, énfasis y enlaces. No pretende cubrir todo el
 * spec de CommonMark; sí lo que Hermes produce como salida hablada→escrita.
 *
 * Las referencias a documentos del vault — wikilinks `[[nombre]]` y enlaces a
 * `*.md` — se vuelven clickables y abren el visor tipo Notion (ver DocViewer).
 */

// Proyecto en foco del <Markdown> actual: desambigua wikilinks repetidos al
// resolverlos en el server. Lo lee <DocRef> sin tener que pasar props abajo.
const MdProjectCtx = createContext<string | undefined>(undefined);

// ¿La URL de un [texto](url) apunta a un .md del vault (no a http/mailto)?
function isDocLink(href: string): boolean {
  return /\.md(#|\?|$)/i.test(href) && !/^[a-z]+:\/\//i.test(href) && !href.startsWith("mailto:");
}

// Referencia clickable a un doc del vault. Cae a texto plano si no hay visor.
function DocRef({ refName, label }: { refName: string; label: string }) {
  const open = useDocViewer();
  const project = useContext(MdProjectCtx);
  return (
    <button
      type="button"
      className="md-ref"
      onClick={() => open(refName, project)}
      title={`Abrir ${label}`}
    >
      {label}
    </button>
  );
}

function renderInline(text: string, kp: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[\[[^\]]+\]\])|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${kp}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("[[")) {
      // Wikilink: "[[nombre|alias]]" → ref=nombre, muestra el alias si lo hay.
      const inner = tok.slice(2, -2);
      const [name, alias] = inner.split("|");
      nodes.push(<DocRef key={key} refName={name.trim()} label={(alias ?? name).trim()} />);
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (mm && isDocLink(mm[2])) {
        nodes.push(<DocRef key={key} refName={mm[2]} label={mm[1]} />);
      } else {
        nodes.push(
          mm ? (
            <a key={key} href={mm[2]} target="_blank" rel="noreferrer" className="md-link">
              {mm[1]}
            </a>
          ) : (
            tok
          ),
        );
      }
    } else {
      nodes.push(<em key={key}>{tok.replace(/^[*_]|[*_]$/g, "")}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const SPECIAL = /^(#{1,6})\s|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+\.\s+|^(-{3,}|\*{3,}|_{3,})\s*$/;

export function Markdown({ source, project }: { source: string; project?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código ```
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // cierra la valla
      blocks.push(
        <pre key={key++} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Título
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length, 4);
      const Tag = `h${lvl}` as "h1" | "h2" | "h3" | "h4";
      // Ojo: el key de JSX se evalúa DESPUÉS de los children — key++ inline
      // dentro de los children desfasaba el key del elemento y chocaba con el
      // del bloque siguiente. Se fija ANTES en una const.
      const k = key++;
      blocks.push(
        <Tag key={k} className={`md-h md-h${lvl}`}>
          {renderInline(h[2], `h${k}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Separador
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // Cita
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      const k = key++;
      blocks.push(
        <blockquote key={k} className="md-quote">
          {renderInline(buf.join(" "), `q${k}`)}
        </blockquote>,
      );
      continue;
    }

    // Lista no ordenada
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(
          <li key={items.length} className="md-li">
            {renderInline(lines[i].replace(/^\s*[-*+]\s+/, ""), `li${key}-${items.length}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items}
        </ul>,
      );
      continue;
    }

    // Lista ordenada
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={items.length} className="md-li">
            {renderInline(lines[i].replace(/^\s*\d+\.\s+/, ""), `ol${key}-${items.length}`)}
          </li>,
        );
        i++;
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items}
        </ol>,
      );
      continue;
    }

    // Línea en blanco
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Párrafo (junta líneas consecutivas no especiales)
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !SPECIAL.test(lines[i])) {
      buf.push(lines[i++]);
    }
    const k = key++;
    blocks.push(
      <p key={k} className="md-p">
        {renderInline(buf.join(" "), `p${k}`)}
      </p>,
    );
  }

  return (
    <MdProjectCtx.Provider value={project}>
      <div className="md">{blocks}</div>
    </MdProjectCtx.Provider>
  );
}
