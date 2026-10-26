import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { markRunning } from "../drawing.js";
import type { GraphDrawings, GraphKind, TaskView } from "../snapshot.js";
import { drawnIds } from "../stages.js";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
// The stage boxes take the page's accent; the nodes keep LangGraph's own styles. Drawings keep their natural size and scroll.
mermaid.initialize({
  startOnLoad: false, securityLevel: "strict", theme: "base", flowchart: { useMaxWidth: false },
  themeVariables: dark
    ? { darkMode: true, background: "#1b2227", clusterBkg: "#16343a", clusterBorder: "#4fb8c4", lineColor: "#9aa6b0", primaryTextColor: "#1d2329", titleColor: "#e4e9ed", edgeLabelBackground: "#1b2227" }
    : { clusterBkg: "#e2f1f2", clusterBorder: "#0f6e7a", lineColor: "#5d6873", titleColor: "#1d2329" },
});

let renders = 0;

/** One graph's drawing from LangGraph, as LangGraph draws it, with the nodes running now marked. */
function Drawing({ kind, drawing, tasks }: { kind: GraphKind; drawing: string; tasks: readonly TaskView[] }) {
  const running = tasks.map((task) => [...task.path, task.node].join(":"));
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = markRunning(drawing, tasks.map((task) => drawnIds(task.path, task.node)));
  useEffect(() => {
    let current = true;
    mermaid.render(`graph-${kind}-${++renders}`, source)
      .then((result) => { if (current) { setSvg(result.svg); setError(null); } })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; };
  }, [kind, source]);
  return (
    <section className="drawing" aria-label={`${kind} graph`}>
      <h3>{kind} graph <span className="muted small">{running.length === 0 ? "nothing running" : `running: ${[...new Set(running)].join(", ")}`}</span></h3>
      {error !== null ? <p className="error">The drawing cannot be rendered: {error}</p>
        : svg === null ? <p className="muted">Drawing…</p>
        // Mermaid renders with securityLevel strict from LangGraph's own drawing of our graphs.
        : <div dangerouslySetInnerHTML={{ __html: svg }} />}
    </section>
  );
}

export function NodeView({ drawings, tasks }: { drawings: GraphDrawings | null; tasks: readonly TaskView[] }) {
  if (drawings === null) return <p className="muted">Loading the graphs…</p>;
  return (
    <div className="side">
      {(Object.entries(drawings) as [GraphKind, string][]).map(([kind, drawing]) => (
        <Drawing key={kind} kind={kind} drawing={drawing} tasks={tasks.filter((task) => task.graph === kind && task.state === "running")} />
      ))}
    </div>
  );
}
