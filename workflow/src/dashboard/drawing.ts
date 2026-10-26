// Shared by the server and the React client.

function declares(drawing: string, id: string): boolean {
  return drawing.includes(`\n\t${id}(`);
}

/**
 * Marks the running nodes in LangGraph's Mermaid drawing, leaving the drawing itself as it is. Each node is given as its
 * possible IDs, best first, and the first one the drawing declares is marked.
 */
export function markRunning(drawing: string, nodes: readonly (readonly string[])[]): string {
  const marked = [...new Set(nodes.flatMap((ids) => ids.find((id) => declares(drawing, id)) ?? []))];
  if (marked.length === 0) return drawing;
  return `${drawing.trimEnd()}\n\tclassDef running stroke:#b5531a,stroke-width:3px,fill:#fbe9dc;\n\tclass ${marked.join(",")} running;\n`;
}
