import type { ControlRequest, GraphDrawings, Snapshot } from "../snapshot.js";

const token = document.querySelector<HTMLMetaElement>("meta[name=dashboard-token]")?.content ?? "";

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error: string };
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body ? body.error : `HTTP ${response.status}`);
  return body as T;
}

export async function fetchSnapshot(loop: string | null): Promise<Snapshot> {
  return json<Snapshot>(await fetch(loop === null ? "/api/snapshot" : `/api/snapshot?loop=${encodeURIComponent(loop)}`, { cache: "no-store" }));
}

export async function fetchGraphs(): Promise<GraphDrawings> {
  return json<GraphDrawings>(await fetch("/api/graphs", { cache: "no-store" }));
}

export async function postControl(request: ControlRequest): Promise<void> {
  await json<unknown>(await fetch("/api/control", {
    method: "POST", headers: { "content-type": "application/json", "x-dashboard-token": token }, body: JSON.stringify(request),
  }));
}
