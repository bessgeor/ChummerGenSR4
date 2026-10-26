// The page's styles; tokens follow the loop diagram, with dark values for a dark system theme.
export const styles = `/* Layout: a narrow reading column for the "as is" part, then a wide working mockup. Tokens follow the loop diagram. */
:root{
  --bg:#f6f7f8; --surface:#ffffff; --fg:#1d2329; --muted:#5d6873; --line:#8a96a1; --rule:#d9dee2;
  --accent:#0f6e7a; --accent-soft:#e2f1f2; --run:#b5531a; --run-soft:#fbe9dc; --ok:#2f7d4f; --warn:#a4561c;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#13181c; --surface:#1b2227; --fg:#e4e9ed; --muted:#9aa6b0; --line:#6c7a85; --rule:#2c363d;
  --accent:#4fb8c4; --accent-soft:#16343a; --run:#f0955a; --run-soft:#3b2416; --ok:#6cc18f; --warn:#e09a62; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#13181c; --surface:#1b2227; --fg:#e4e9ed; --muted:#9aa6b0; --line:#6c7a85; --rule:#2c363d;
  --accent:#4fb8c4; --accent-soft:#16343a; --run:#f0955a; --run-soft:#3b2416; --ok:#6cc18f; --warn:#e09a62; color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:14px;line-height:1.5;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 48px}
main{max-width:1280px;margin:0 auto;display:grid;gap:14px}
.read{max-width:820px;display:grid;gap:14px}
h1{font-size:1.65rem;margin:0;font-weight:600;text-wrap:balance}
h2{font-size:1.25rem;margin:0;font-weight:600;text-wrap:balance}
h3{font-size:1rem;margin:0;font-weight:600}
p{margin:0;max-width:68ch}
.eyebrow{font-family:var(--mono);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.muted{color:var(--muted)} .small{font-size:.82rem} .mono{font-family:var(--mono);font-size:.88em}
code{font-family:var(--mono);font-size:.86em}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.cols>*{min-width:0}
.box{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:14px;display:grid;gap:10px;min-width:0}
.scroll{overflow-x:auto}
pre.mermaid{margin:0;background:transparent}
pre.json{margin:0;font-family:var(--mono);font-size:.78rem;background:var(--bg);border-radius:6px;padding:10px;overflow-x:auto;white-space:pre}
ul.gap{margin:0;padding-left:1.1rem;display:grid;gap:6px;max-width:72ch}
hr{border:0;border-top:1px solid var(--rule);margin:8px 0}
.note{border-left:3px solid var(--warn);padding:6px 12px;background:var(--surface);border-radius:0 6px 6px 0;font-size:.9rem}

/* Mockup */
.app{display:grid;gap:14px}
.top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:12px 14px}
.top h2{font-size:1.1rem}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{font:600 .85rem var(--sans);border:1px solid var(--accent);background:var(--accent);color:var(--surface);border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover{filter:brightness(1.1)} button:focus-visible{outline:2px solid var(--run);outline-offset:2px}
.pill{font:600 .78rem var(--mono);padding:3px 10px;border-radius:99px;border:1px solid}
.pill.running{color:var(--ok);border-color:var(--ok)} .pill.pausing{color:var(--run);border-color:var(--run);background:var(--run-soft)} .pill.paused{color:var(--warn);border-color:var(--warn)}
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.lane{background:var(--surface);border:1px solid var(--rule);border-left:4px solid var(--line);border-radius:8px;padding:10px 12px;display:grid;gap:6px;min-width:0}
.lane.busy{border-left-color:var(--run)} .lane.paused{border-left-color:var(--warn)} .lane.idle{border-left-color:var(--ok)}
.lane button{justify-self:start;background:transparent;color:var(--accent)}
.grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:start}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
.fig{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:10px;overflow-x:auto}
.fig svg{display:block;min-width:600px;width:100%;height:auto}
svg text{font-family:var(--sans);fill:var(--fg)}
.t{font-size:13px;font-weight:600} .t.mid,.s.mid{text-anchor:middle}
.s{font-size:11px;fill:var(--muted)!important;font-family:var(--mono)}
.lbl{font-size:11px;fill:var(--muted)!important}
.tag{font-size:11px;font-weight:600;fill:var(--accent)!important;font-family:var(--mono)}
.edge{stroke:var(--line);stroke-width:1.4;fill:none} .edge.loop{stroke:var(--accent);stroke-width:1.8}
.arrow{fill:var(--line)} .arrow.loop{fill:var(--accent)}
.frame{fill:none;stroke:var(--accent);stroke-width:1.4} .thread{fill:none;stroke:var(--line);stroke-dasharray:5 4}
.dia,.end{fill:var(--surface);stroke:var(--line);stroke-width:1.2}
.stage{cursor:pointer} .stage>rect{fill:var(--surface);stroke:var(--line);stroke-width:1.2}
.stage:hover>rect,.stage:focus-visible>rect{stroke:var(--accent)}
.stage.selected>rect{stroke:var(--accent);stroke-width:2.2}
.stage.running>rect{fill:var(--run-soft);stroke:var(--run);stroke-width:2}
.stage:focus{outline:none}
.badge{fill:var(--run)} .badge-t{font:600 10px var(--mono);fill:var(--surface)!important;text-anchor:middle}
@media (prefers-reduced-motion:no-preference){.stage.running>rect{animation:pulse 1.6s ease-in-out infinite}}
@keyframes pulse{50%{stroke-opacity:.35}}
.side{display:grid;gap:14px;min-width:0}
.panel{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:12px 14px;display:grid;gap:10px;min-width:0}
.detail header{display:grid;gap:2px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0}
.stats div{display:grid;gap:2px} dt{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
dd{margin:0;font:600 1.35rem var(--mono);font-variant-numeric:tabular-nums;display:grid}
dd small{font:400 .75rem var(--sans);color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} .wrap{word-break:break-all}

.tabs{display:flex;gap:6px}
.tabs button{background:transparent;color:var(--accent)}
.tabs button[aria-selected=true]{background:var(--accent);color:var(--surface)}
button:disabled{opacity:.45;cursor:default}
select{font:inherit;background:var(--surface);color:var(--fg);border:1px solid var(--rule);border-radius:6px;padding:4px 6px}
.problems{border-left:3px solid var(--warn);background:var(--surface);border-radius:0 8px 8px 0;padding:8px 12px;display:grid;gap:4px;font-size:.85rem}
.problems b{color:var(--warn)}
.notice{color:var(--muted);font-size:.85rem}
.nodes{display:flex;flex-wrap:wrap;gap:4px}
.nodes code{background:var(--bg);border-radius:4px;padding:1px 5px}
.drawing{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:10px;overflow-x:auto;display:grid;gap:8px}
.drawing svg{max-width:none}
.grid.wide{grid-template-columns:1fr}
.error{color:var(--warn)}
`;
