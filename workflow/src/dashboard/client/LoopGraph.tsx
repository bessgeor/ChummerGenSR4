import type { KeyboardEvent } from "react";
import type { StageId, StageView } from "../snapshot.js";
import { formatCount, formatDuration } from "./format.js";

/** Where each stage's box sits in the loop diagram. */
const layout: Readonly<Record<StageId, { x: number; y: number; w: number }>> = {
  start: { x: 90, y: 40, w: 300 }, capture: { x: 90, y: 115, w: 300 }, discovery: { x: 470, y: 185, w: 240 },
  diagnose: { x: 90, y: 265, w: 300 }, repair: { x: 90, y: 340, w: 300 }, widen: { x: 90, y: 415, w: 300 },
  conclude: { x: 90, y: 495, w: 300 }, tune: { x: 90, y: 580, w: 300 },
};

function StageBox({ stage, selected, onSelect }: { stage: StageView; selected: boolean; onSelect: (id: StageId) => void }) {
  const { x, y, w } = layout[stage.id];
  const first = stage.stats.counts[0];
  const active = stage.running + stage.paused;
  const classes = ["stage", stage.running > 0 ? "running" : "", selected ? "selected" : ""].filter((name) => name.length > 0).join(" ");
  const onKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(stage.id);
    }
  };
  return (
    <g className={classes} onClick={() => onSelect(stage.id)} onKeyDown={onKey} tabIndex={0} role="button"
      aria-pressed={selected} aria-label={`${stage.title}: ${stage.running} running`}>
      <rect x={x} y={y} width={w} height={50} rx={8} />
      <text className="t" x={x + 12} y={y + 21}>{stage.title}</text>
      <text className="s" x={x + 12} y={y + 39}>
        {`p80 ${formatDuration(stage.stats.duration.p80Ms)}${first === undefined ? "" : ` · ${first.name} ${formatCount(first.value)}`}`}
      </text>
      {active > 0 ? (
        <g>
          <rect className="badge" x={x + w - 78} y={y + 9} width={68} height={18} rx={9} />
          <text className="badge-t" x={x + w - 44} y={y + 22}>{stage.running > 0 ? `${stage.running} running` : `${stage.paused} paused`}</text>
        </g>
      ) : null}
    </g>
  );
}

/** The loop diagram: the stages of one workflow thread inside the loop that starts the next thread. */
export function LoopGraph({ stages, selected, onSelect }: { stages: readonly StageView[]; selected: StageId; onSelect: (id: StageId) => void }) {
  return (
    <svg viewBox="0 0 780 740" role="group" aria-label="The loop's stages; highlighted stages run now">
      <defs>
        <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="arrow" d="M0 0L10 5L0 10z" /></marker>
        <marker id="al" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className="arrow loop" d="M0 0L10 5L0 10z" /></marker>
      </defs>
      <rect className="frame" x="12" y="8" width="756" height="722" rx="12" />
      <text className="tag" x="754" y="27" textAnchor="end">loop</text>
      <rect className="thread" x="60" y="34" width="680" height="524" rx="10" />
      <text className="lbl" x="728" y="52" textAnchor="end">one workflow thread</text>
      <polygon className="dia" points="240,182 320,210 240,238 160,210" />
      <text className="t mid" x="240" y="214">Any difference?</text>
      <polygon className="dia" points="240,652 340,684 240,716 140,684" />
      <text className="t mid" x="240" y="688">Anything changed?</text>
      <rect className="end" x="470" y="659" width="240" height="50" rx="8" />
      <text className="t mid" x="590" y="680">Converged</text>
      <text className="s mid" x="590" y="697">or limit, stop, failure</text>
      <path className="edge" d="M240 90V113" markerEnd="url(#a)" />
      <path className="edge" d="M240 165V180" markerEnd="url(#a)" />
      <path className="edge" d="M240 238V263" markerEnd="url(#a)" />
      <text className="lbl" x="248" y="255">yes</text>
      <path className="edge" d="M320 210H468" markerEnd="url(#a)" />
      <text className="lbl" x="335" y="203">no</text>
      <path className="edge" d="M240 315V338" markerEnd="url(#a)" />
      <path className="edge" d="M240 390V413" markerEnd="url(#a)" />
      <path className="edge" d="M240 465V493" markerEnd="url(#a)" />
      <path className="edge" d="M390 440H420V365H392" markerEnd="url(#a)" />
      <text className="lbl" x="428" y="405">rejected, tries left</text>
      <path className="edge" d="M590 235V520H392" markerEnd="url(#a)" />
      <path className="edge" d="M240 545V578" markerEnd="url(#a)" />
      <path className="edge" d="M240 630V650" markerEnd="url(#a)" />
      <path className="edge" d="M340 684H468" markerEnd="url(#a)" />
      <path className="edge loop" d="M140 684H40V65H88" markerEnd="url(#al)" />
      <text className="tag" x="34" y="380" textAnchor="middle" transform="rotate(-90 34 380)">yes: next thread</text>
      {stages.map((stage) => <StageBox key={stage.id} stage={stage} selected={selected === stage.id} onSelect={onSelect} />)}
    </svg>
  );
}
