// The tool belt: every tool the run goes through, in order. At rest it is the proof of how the work
// gets made; during a run it is the progress bar, lighting up stage by stage.

import { Check } from 'lucide-react';
import { STAGES, TOOLS, type Stage, type Tool, type ToolId } from '../tools';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** What Izzad does with each tool, in its own words. */
const JOB: Record<ToolId, string> = {
  chatgpt: 'I read your site here and write the brief and the copy.',
  claude: 'This drives the run: every step in order, nothing dropped between tools.',
  higgsfield: 'Visuals get generated here, in your brand’s look.',
  magnific: 'Then upscaled, so they hold up at poster size.',
  photoshop: 'Retouch, composite and grade.',
  illustrator: 'Type, layout and the vector work.',
  capcut: 'Cuts and captions, when you ask for video.',
};

/** What a hover hands back: the words for the avatar to say and the element to look at. */
export type Tell = (line: string | null, el?: Element | null) => void;

export function Logo({ tool, size = 36 }: { tool: Tool; size?: number }) {
  const { logo } = tool;
  return (
    <span className="iz-logo" style={{ width: size, height: size, background: logo.bg, borderRadius: Math.round(size * 0.24) }}>
      <img
        src={logo.src}
        alt=""
        draggable={false}
        style={{ padding: logo.inset ? `${logo.inset * 100}%` : 0, objectFit: logo.inset ? 'contain' : 'cover', filter: logo.invert ? 'invert(1)' : undefined }}
      />
    </span>
  );
}

export function Belt({ at, finished, tell }: { at: Stage | null; finished: boolean; tell: Tell }) {
  const reached = at ? STAGES.indexOf(at) : -1;
  const running = at !== null && !finished;
  return (
    <nav className={cx('iz-belt', running && 'is-running')} aria-label="How Izzad builds it: the tools, in order">
      <span className="iz-belt-title">How I build it</span>
      <div className="iz-belt-row">
        {STAGES.map((stage, i) => {
          const done = finished || i < reached;
          const active = running && i === reached;
          return (
            <div key={stage} data-stage={stage} className={cx('iz-belt-stage', done && 'is-done', active && 'is-active')} aria-current={active ? 'step' : undefined}>
              <span className="iz-belt-label">
                {done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                {stage}
              </span>
              <div className="iz-belt-tools">
                {TOOLS.filter((t) => t.stage === stage).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="iz-tool"
                    aria-label={`${t.name}. ${JOB[t.id]}`}
                    onPointerEnter={(e) => tell(`*${t.name}.* ${JOB[t.id]}`, e.currentTarget)}
                    onPointerLeave={() => tell(null)}
                    onFocus={(e) => tell(`*${t.name}.* ${JOB[t.id]}`, e.currentTarget)}
                    onBlur={() => tell(null)}
                  >
                    <span className="iz-tool-icon">
                      <Logo tool={t} size={44} />
                    </span>
                    <span className="iz-tool-name">{t.short}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
