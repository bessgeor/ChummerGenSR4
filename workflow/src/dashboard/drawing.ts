// Shared by the server and the React client.

/** Marks the running nodes in LangGraph's Mermaid drawing, leaving the drawing itself as it is. */
export function markRunning(drawing: string, nodes: readonly string[]): string {
  if (nodes.length === 0) return drawing;
  return `${drawing.trimEnd()}\n\tclassDef running stroke:#b5531a,stroke-width:3px,fill:#fbe9dc;\n\tclass ${[...new Set(nodes)].join(",")} running;\n`;
}
