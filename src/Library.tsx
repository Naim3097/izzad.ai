import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { Inspector } from './Inspector';
import { AssetTile, Empty, KIND_LABEL, cx, fmtSize, kindOf, type Kind } from './parts';
import { storageBytes, useStore } from './store';
import { TOOLS, type ToolId } from './tools';
import { ORIGINS, ORIGIN_LABEL, type Bin, type Origin } from './types';

const KINDS: Kind[] = ['image', 'video', 'vector', 'design', 'audio', 'text', 'other'];

/** Every asset across every tool, in one searchable grid. The search box lives in the top bar. */
export function Library({ projectId, query, onClearQuery }: { projectId: string; query: string; onClearQuery: () => void }) {
  const { assets } = useStore();
  const [tool, setTool] = useState<ToolId | ''>('');
  const [bin, setBin] = useState<Bin | ''>('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const list = assets.filter(
    (a) =>
      (!projectId || a.projectId === projectId) &&
      (!tool || a.tool === tool) &&
      (!bin || a.bin === bin) &&
      (!origin || a.origin === origin) &&
      (!kind || kindOf(a) === kind) &&
      (!needle || a.name.toLowerCase().includes(needle) || a.tags.some((t) => t.includes(needle)) || a.note.toLowerCase().includes(needle)),
  );
  const selected = list.find((a) => a.id === selectedId) ?? null;
  const filtered = Boolean(tool || bin || origin || kind || needle);

  const clear = () => {
    setTool('');
    setBin('');
    setOrigin('');
    setKind('');
    onClearQuery();
  };

  return (
    <div className={cx('library', selected && 'has-inspector')}>
      <section className="center">
        <header className="lib-head">
          <div className="lib-title">
            <h1 className="t-title">Library</h1>
            <p className="t-meta">
              {list.length} {list.length === 1 ? 'file' : 'files'} · {fmtSize(storageBytes(list))}
              {needle && <> · matching “{query.trim()}”</>}
            </p>
          </div>
          <div className="filters">
            <select className={cx('input filter', tool && 'is-set')} value={tool} onChange={(e) => setTool(e.target.value as ToolId | '')} aria-label="Filter by tool">
              <option value="">All tools</option>
              {TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select className={cx('input filter', bin && 'is-set')} value={bin} onChange={(e) => setBin(e.target.value as Bin | '')} aria-label="Filter by bin">
              <option value="">In and out</option>
              <option value="in">Inputs</option>
              <option value="out">Outputs</option>
            </select>
            <select className={cx('input filter', origin && 'is-set')} value={origin} onChange={(e) => setOrigin(e.target.value as Origin | '')} aria-label="Filter by maker">
              <option value="">Made by anyone</option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABEL[o]}
                </option>
              ))}
            </select>
            <select className={cx('input filter', kind && 'is-set')} value={kind} onChange={(e) => setKind(e.target.value as Kind | '')} aria-label="Filter by type">
              <option value="">Any type</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {filtered && (
              <button className="btn btn-ghost" onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </header>
        <div className="stage-scroll">
          {list.length === 0 ? (
            <Empty
              icon={<SearchX size={22} />}
              title={filtered ? 'Nothing matches' : 'Your library is empty'}
              hint={filtered ? 'Try fewer filters or a different search.' : 'Files are added inside a tool, so each one knows where it belongs.'}
            >
              {filtered && (
                <button className="btn" onClick={clear}>
                  Clear filters
                </button>
              )}
            </Empty>
          ) : (
            <div className="grid">
              {list.map((a) => (
                <AssetTile key={a.id} asset={a} showTool selected={a.id === selectedId} onSelect={() => setSelectedId(a.id)} />
              ))}
            </div>
          )}
        </div>
      </section>
      {selected && <Inspector asset={selected} onGone={() => setSelectedId(null)} />}
    </div>
  );
}
