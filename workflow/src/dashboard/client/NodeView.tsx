import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { markRunning } from "../drawing.js";
import type { GraphDrawings, GraphKind, TaskView } from "../snapshot.js";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });

let renders = 0;

/** One graph's drawing from LangGraph, as LangGraph draws it, with the nodes running now marked. */
function Drawing({ kind, drawing, running }: { kind: GraphKind; drawing: string; running: readonly string[] }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = markRunning(drawing, running);
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
        <Drawing key={kind} kind={kind} drawing={drawing} running={tasks.filter((task) => task.graph === kind && task.state === "running").map((task) => task.node)} />
      ))}
    </div>
  );
}
