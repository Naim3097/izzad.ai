import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { loadDemo } from './demo';
import { AssetTile, BrandMark, ConfirmButton, ToolLogo, cx, fmtSize } from './parts';
import { storageBytes, useStore } from './store';
import { STAGES, TOOLS, type Stage, type ToolId } from './tools';
import { ORIGINS, ORIGIN_LABEL, PROJECT_STATUSES, STATUS_LABEL, type Asset, type ProjectStatus } from './types';

const DAY = 86_400_000;
const DAYS = 14;

const STAGE_LINE: Record<Stage, string> = {
  Think: 'Shape the idea',
  Generate: 'Make the raw material',
  Craft: 'Make it yours',
  Cut: 'Assemble and ship',
};

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Overview({ projectId, onOpenTool, onOpenAsset }: { projectId: string; onOpenTool: (id: ToolId) => void; onOpenAsset: (a: Asset) => void }) {
  const store = useStore();
  const { assets, projects } = store;
  const [busy, setBusy] = useState(false);

  if (assets.length === 0 && projects.length === 0) {
    return (
      <div className="home">
        <section className="hero">
          <BrandMark size={104} />
          <h1 className="hero-title">
            Every tool you use.
            <br />
            One continuous flow.
          </h1>
          <p className="hero-sub">
            Izzad keeps the files that move between your tools in one place. Open a tool, bring in what you need, drop back what you made. The machines
            make more. You still decide what ships.
          </p>
          <div className="hero-actions">
            <button
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await loadDemo(store);
                setBusy(false);
              }}
            >
              {busy ? 'Loading sample…' : 'Explore with a sample project'}
            </button>
            <button className="btn btn-lg" onClick={() => onOpenTool(TOOLS[0].id)}>
              Start empty in {TOOLS[0].name}
            </button>
          </div>
        </section>
        <Pipeline assets={[]} onOpenTool={onOpenTool} />
      </div>
    );
  }

  const scoped = projectId ? assets.filter((a) => a.projectId === projectId) : assets;
  const outs = scoped.filter((a) => a.bin === 'out');
  const now = Date.now();
  const out7 = outs.filter((a) => a.createdAt > now - 7 * DAY).length;
  const outPrev7 = outs.filter((a) => a.createdAt <= now - 7 * DAY && a.createdAt > now - 14 * DAY).length;
  const handoffs = scoped.filter((a) => a.parentId).length;
  const active = projects.filter((p) => p.status !== 'DELIVERED').length;
  const delta = out7 - outPrev7;

  // Outputs per day, oldest to newest.
  const today = startOfDay(now);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const from = today - (DAYS - 1 - i) * DAY;
    return { from, count: outs.filter((a) => a.createdAt >= from && a.createdAt < from + DAY).length };
  });

  const split = ORIGINS.map((origin) => ({ origin, n: outs.filter((a) => a.origin === origin).length }));
  const touched = split[0].n + split[1].n;

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="t-display">{greeting()}.</h1>
        <p className="home-sub">
          {plural(out7, 'output')} in the last 7 days across {plural(active, 'active project')}.
        </p>
      </header>

      <Pipeline assets={scoped} onOpenTool={onOpenTool} />

      <section className="stats">
        <Stat label="Files" value={String(scoped.length)} sub={`${plural(outs.length, 'output')} so far`} />
        <Stat
          label="Outputs this week"
          value={String(out7)}
          sub={outPrev7 === 0 ? 'First week on record' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} vs the week before`}
        />
        <Stat label="Handoffs" value={String(handoffs)} sub="Files passed tool to tool" />
        <Stat label="On disk" value={fmtSize(storageBytes(scoped))} sub="Stored locally in this browser" />
      </section>

      <div className="two-col">
        <section className="card">
          <header className="card-head">
            <h2 className="t-head">Output</h2>
            <span className="t-meta">Files landed in an Out bin, last {DAYS} days</span>
          </header>
          <DayBars days={days} />
        </section>

        <section className="card">
          <header className="card-head">
            <h2 className="t-head">Authorship</h2>
            <span className="t-meta">Who made what ships</span>
          </header>
          {outs.length === 0 ? (
            <p className="t-meta card-pad">No outputs yet.</p>
          ) : (
            <div className="card-pad">
              <p className="split-line">
                <strong>
                  {touched} of {outs.length}
                </strong>{' '}
                outputs passed through your hands.
              </p>
              <div className="split-bar" role="img" aria-label={split.map((s) => `${ORIGIN_LABEL[s.origin]} ${s.n}`).join(', ')}>
                {split
                  .filter((s) => s.n > 0)
                  .map((s) => (
                    <div
                      key={s.origin}
                      className={cx('split-seg', `split-${s.origin}`)}
                      style={{ flexGrow: s.n }}
                      title={`${ORIGIN_LABEL[s.origin]}: ${s.n} of ${outs.length}`}
                    />
                  ))}
              </div>
              <div className="split-legend">
                {split.map((s) => (
                  <div key={s.origin} className="split-key">
                    <span className={cx('swatch', `split-${s.origin}`)} />
                    <span>{ORIGIN_LABEL[s.origin]}</span>
                    <span className="split-n">{s.n}</span>
                    <span className="split-pct">{Math.round((s.n / outs.length) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <Projects />

      <section className="card">
        <header className="card-head">
          <h2 className="t-head">Recent</h2>
          <span className="t-meta">Opens in its tool</span>
        </header>
        {scoped.length === 0 ? (
          <p className="t-meta card-pad">Nothing in this project yet.</p>
        ) : (
          <div className="grid grid-sm card-pad">
            {scoped.slice(0, 12).map((a) => (
              <AssetTile key={a.id} asset={a} selected={false} showTool onSelect={() => onOpenAsset(a)} />
            ))}
          </div>
        )}
      </section>

      <footer className="home-foot">
        <span className="t-cap">Everything is stored in this browser, on this machine. Nothing is uploaded.</span>
        <ConfirmButton className="btn btn-ghost btn-danger" confirmLabel="Erase everything?" onConfirm={() => store.wipe()}>
          Erase all data
        </ConfirmButton>
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="t-meta">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="t-cap">{sub}</span>
    </div>
  );
}

function DayBars({ days }: { days: { from: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const total = days.reduce((n, d) => n + d.count, 0);
  const peak = Math.max(1, ...days.map((d) => d.count));
  const shown = hover === null ? null : days[hover];
  return (
    <div className="card-pad">
      <div className="bars-read">
        <strong>{shown ? shown.count : total}</strong>
        <span className="t-meta">{shown ? fmt(shown.from) : `outputs in ${DAYS} days`}</span>
      </div>
      <div className="bars" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div
            key={d.from}
            className={cx('bar-slot', hover === i && 'is-hover', d.count === 0 && 'is-zero')}
            onMouseEnter={() => setHover(i)}
            tabIndex={0}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${fmt(d.from)}: ${d.count} outputs`}
          >
            <div className="bar" style={{ height: d.count === 0 ? 3 : `${(d.count / peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis t-cap">
        <span>{new Date(days[0].from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Pipeline({ assets, onOpenTool }: { assets: Asset[]; onOpenTool: (id: ToolId) => void }) {
  return (
    <section className="pipeline" aria-label="Pipeline">
      {STAGES.map((stage, i) => (
        <div key={stage} className="pipe-stage">
          <header className="pipe-head">
            <span className="pipe-n">{i + 1}</span>
            <div>
              <h2 className="t-head">{stage}</h2>
              <p className="t-cap">{STAGE_LINE[stage]}</p>
            </div>
          </header>
          <div className="pipe-tools">
            {TOOLS.filter((t) => t.stage === stage).map((t) => {
              const mine = assets.filter((a) => a.tool === t.id);
              const nIn = mine.filter((a) => a.bin === 'in').length;
              const nOut = mine.length - nIn;
              return (
                <button key={t.id} className="pipe-tool" onClick={() => onOpenTool(t.id)}>
                  <ToolLogo tool={t} size={36} />
                  <span className="pipe-tool-text">
                    <span className="pipe-tool-name">{t.name}</span>
                    <span className="t-cap">
                      {nIn} in · {nOut} out
                    </span>
                  </span>
                  <ChevronRight size={16} className="pipe-tool-go" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function Projects() {
  const { projects, assets, addProject, updateProject, removeProject } = useStore();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');

  const create = () => {
    if (!name.trim()) return;
    addProject({ name: name.trim(), client: client.trim(), status: 'BRIEF', due: '' });
    setName('');
    setClient('');
  };

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="t-head">Projects</h2>
        <span className="t-meta">{plural(projects.length, 'project')}</span>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Status</th>
              <th>Due</th>
              <th className="num">Files</th>
              <th className="num">Outputs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const mine = assets.filter((a) => a.projectId === p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      className="input input-cell is-strong"
                      defaultValue={p.name}
                      aria-label="Project name"
                      onBlur={(e) => e.target.value.trim() && updateProject(p.id, { name: e.target.value.trim() })}
                    />
                  </td>
                  <td>
                    <input className="input input-cell" defaultValue={p.client} aria-label="Client" onBlur={(e) => updateProject(p.id, { client: e.target.value.trim() })} />
                  </td>
                  <td>
                    <select
                      className={cx('input status', `status-${p.status.toLowerCase()}`)}
                      value={p.status}
                      aria-label="Status"
                      onChange={(e) => updateProject(p.id, { status: e.target.value as ProjectStatus })}
                    >
                      {PROJECT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input input-cell" type="date" value={p.due} aria-label="Due date" onChange={(e) => updateProject(p.id, { due: e.target.value })} />
                  </td>
                  <td className="num">{mine.length}</td>
                  <td className="num">{mine.filter((a) => a.bin === 'out').length}</td>
                  <td className="num">
                    <ConfirmButton className="icon-btn icon-btn-danger" label={`Remove ${p.name}`} confirmLabel="Remove?" onConfirm={() => removeProject(p.id)}>
                      <Trash2 size={15} />
                    </ConfirmButton>
                  </td>
                </tr>
              );
            })}
            <tr className="table-new">
              <td>
                <input
                  className="input input-cell"
                  placeholder="New project"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </td>
              <td>
                <input
                  className="input input-cell"
                  placeholder="Client"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </td>
              <td colSpan={5}>
                <button className="btn btn-ghost" disabled={!name.trim()} onClick={create}>
                  <Plus size={15} /> Add project
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
