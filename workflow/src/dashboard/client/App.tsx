import { useCallback, useEffect, useState } from "react";
import type { GraphDrawings, LaneView, LoopView, Snapshot, StageId, StageView, TaskView } from "../snapshot.js";
import { fetchGraphs, fetchSnapshot, postControl } from "./api.js";
import { formatCount, formatDuration, since } from "./format.js";
import { LoopGraph } from "./LoopGraph.js";
import { NodeView } from "./NodeView.js";

/** How often the page reads the snapshot. */
const pollMs = 2000;

const statusText: Readonly<Record<LoopView["status"], string>> = {
  running: "running", pausing: "pausing: running tasks finish first", paused: "paused", ended: "ended", stale: "no state for over 30 s: is the loop still running?",
};

function LoopHeader({ snapshot, selected, onSelect, onControl }: {
  snapshot: Snapshot; selected: string | null; onSelect: (loop: string | null) => void; onControl: (lane: string | null, paused: boolean) => void;
}) {
  const loop = snapshot.loop;
  const controllable = loop !== null && loop.status !== "ended";
  return (
    <header className="top">
      <div>
        <h2>{loop === null ? "No loop yet" : <>Loop <span className="mono">{loop.id}</span></>}</h2>
        <p className="muted small">
          {loop === null
            ? "Stats cover every workflow and discovery thread. Pending tasks may belong to an interrupted thread."
            : `${loop.threads.length} threads · started ${since(loop.startedUtc, Date.now())} ago${loop.stateAgeMs === null ? " · no state yet" : ` · state ${formatDuration(loop.stateAgeMs)} old`}`}
        </p>
      </div>
      <div className="controls">
        {snapshot.loops.length > 1 ? (
          <label className="small">Loop{" "}
            <select id="loop-select" value={selected ?? ""} onChange={(event) => onSelect(event.target.value === "" ? null : event.target.value)}>
              <option value="">newest</option>
              {snapshot.loops.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
        ) : null}
        {loop !== null ? <span className={`pill ${loop.status}`}>{statusText[loop.status]}</span> : null}
        <button type="button" id="loop-toggle" disabled={!controllable} onClick={() => loop !== null && onControl(null, !loop.paused)}>
          {loop?.paused === true ? "Resume loop" : "Pause loop"}
        </button>
      </div>
    </header>
  );
}

function Lanes({ lanes, onControl, disabled }: { lanes: readonly LaneView[]; onControl: (lane: string, paused: boolean) => void; disabled: boolean }) {
  if (lanes.length === 0) return null;
  return (
    <section className="lanes" aria-label="Desktop lanes">
      {lanes.map((lane) => {
        const state = lane.paused ? (lane.busy === null ? "paused" : "pausing after this capture") : lane.busy === null ? "idle" : "capturing";
        return (
          <div key={lane.name} className={`lane ${lane.paused ? "paused" : lane.busy === null ? "idle" : "busy"}`}>
            <div><b className="mono">{lane.name}</b> <span className="muted">{state}</span></div>
            <div className="muted small wrap">{lane.busy === null ? "no capture" : `${lane.busy.node} · ${lane.busy.subject ?? "–"} · ${lane.busy.thread}`}</div>
            <button type="button" id={`lane-${lane.name}`} disabled={disabled} onClick={() => onControl(lane.name, !lane.paused)}>{lane.paused ? "Resume lane" : "Pause lane"}</button>
          </div>
        );
      })}
    </section>
  );
}

function StageDetail({ stage, tasks }: { stage: StageView; tasks: readonly TaskView[] }) {
  const { duration } = stage.stats;
  const mine = tasks.filter((task) => task.stage === stage.id);
  return (
    <section className="panel detail" aria-live="polite">
      <header><h3>{stage.title}</h3></header>
      <dl className="stats">
        <div>
          <dt>p80 duration</dt>
          <dd>{formatDuration(duration.p80Ms)}<small>{duration.source === null ? "no finished tasks" : `${duration.samples} ${duration.source === "activity" ? "tasks in the activity log" : "jobs in the eval records"}`}</small></dd>
        </div>
        {stage.stats.counts.map((item) => (
          <div key={item.name}><dt>{item.name}</dt><dd>{formatCount(item.value)}{item.detail === null ? null : <small>{item.detail}</small>}</dd></div>
        ))}
      </dl>
      <div className="nodes">{stage.nodes.map((node) => <code key={node}>{node}</code>)}</div>
      <p className="muted small">{mine.length === 0 ? "Nothing runs in this stage now." : `${mine.length} ${mine.length === 1 ? "task" : "tasks"} now.`}</p>
    </section>
  );
}

function Tasks({ tasks, live, now }: { tasks: readonly TaskView[]; live: boolean; now: number }) {
  return (
    <section className="panel">
      <h3>{live ? "Running now" : "Pending tasks"}</h3>
      {tasks.length === 0 ? <p className="muted small">No task is running.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Node</th><th>Subject</th><th>Lane</th><th>Thread</th><th className="num">For</th></tr></thead>
            <tbody>
              {tasks.map((task, index) => (
                <tr key={`${task.thread}-${task.node}-${task.subject ?? index}`}>
                  <td className="mono">{task.node}{task.state === "paused" ? " (paused)" : ""}</td>
                  <td className="mono wrap">{task.subject ?? "–"}</td>
                  <td>{task.lane ?? "–"}</td>
                  <td className="mono wrap">{task.thread}</td>
                  <td className="num">{since(task.sinceUtc, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">From each thread's checkpoint through LangGraph's getState(); the lane from the loop's state.</p>
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [drawings, setDrawings] = useState<GraphDrawings | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [stage, setStage] = useState<StageId>("capture");
  const [tab, setTab] = useState<"stages" | "nodes">("stages");
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot(selectedLoop));
      setFailure(null);
    } catch (error) {
      setFailure(`The dashboard cannot read its snapshot: ${(error as Error).message}`);
    }
  }, [selectedLoop]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); setNow(Date.now()); }, pollMs);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => { fetchGraphs().then(setDrawings, (error: Error) => setFailure(`The graphs cannot be drawn: ${error.message}`)); }, []);

  const control = (lane: string | null, paused: boolean) => {
    if (snapshot?.loop === null || snapshot === null) return;
    postControl({ loop: snapshot.loop.id, lane, paused }).then(refresh, (error: Error) => setFailure(`The control was refused: ${error.message}`));
  };

  if (snapshot === null) return <main><p className={failure === null ? "muted" : "error"}>{failure ?? "Reading the loop…"}</p></main>;
  const selected = snapshot.stages.find((item) => item.id === stage) ?? snapshot.stages[0]!;
  const problems = failure === null ? snapshot.problems : [{ source: "dashboard", message: failure }, ...snapshot.problems];
  return (
    <main className="app">
      <LoopHeader snapshot={snapshot} selected={selectedLoop} onSelect={setSelectedLoop} onControl={control} />
      {problems.length > 0 ? (
        <section className="problems" role="alert">
          {problems.map((problem, index) => <div key={index}><b>{problem.source}</b>: {problem.message}</div>)}
        </section>
      ) : null}
      <Lanes lanes={snapshot.loop?.lanes ?? []} onControl={control} disabled={snapshot.loop === null || snapshot.loop.status === "ended"} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" id="tab-stages" aria-selected={tab === "stages"} onClick={() => setTab("stages")}>Stages</button>
        <button type="button" role="tab" id="tab-nodes" aria-selected={tab === "nodes"} onClick={() => setTab("nodes")}>LangGraph nodes</button>
      </div>
      <div className={tab === "stages" ? "grid" : "grid wide"}>
        {tab === "stages"
          ? <div className="fig"><LoopGraph stages={snapshot.stages} selected={stage} onSelect={setStage} /></div>
          : <NodeView drawings={drawings} tasks={snapshot.tasks} />}
        <div className="side">
          <StageDetail stage={selected} tasks={snapshot.tasks} />
          <Tasks tasks={snapshot.tasks} live={snapshot.live} now={now} />
        </div>
      </div>
    </main>
  );
}
