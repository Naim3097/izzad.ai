import { House, LayoutGrid, Moon, Search, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Library } from './Library';
import { Overview } from './Overview';
import { ToolWorkspace } from './ToolWorkspace';
import { BrandMark, DropZone, ToolLogo, cx, fmtSize } from './parts';
import { storageBytes, useStore } from './store';
import { STAGES, TOOLS, toolById, type ToolId } from './tools';

type View = 'overview' | 'library' | ToolId;
const VIEWS: View[] = ['overview', 'library', ...TOOLS.map((t) => t.id)];

function remembered<T extends string>(key: string, fallback: T, valid?: readonly string[]): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && (!valid || valid.includes(v))) return v as T;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function DockItem({
  active,
  label,
  hint,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  hint: string;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={cx('dock-item', active && 'is-on')} onClick={onClick} title={hint} aria-current={active ? 'page' : undefined}>
      <span className="dock-icon">
        {children}
        {badge ? <span className="dock-badge">{badge > 99 ? '99+' : badge}</span> : null}
      </span>
      <span className="dock-label">{label}</span>
    </button>
  );
}

export function App() {
  const { ready, assets, projects, sendTo } = useStore();
  const [view, setView] = useState<View>(() => remembered<View>('izzad.view', 'overview', VIEWS));
  const [projectId, setProjectId] = useState<string>(() => remembered('izzad.project', ''));
  const [theme, setTheme] = useState<'dark' | 'light'>(() => remembered('izzad.theme', 'dark', ['dark', 'light']));
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<ToolId | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => remember('izzad.view', view), [view]);
  useEffect(() => remember('izzad.project', projectId), [projectId]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember('izzad.theme', theme);
  }, [theme]);

  // A remembered project that no longer exists falls back to "all".
  useEffect(() => {
    if (ready && projectId && !projects.some((p) => p.id === projectId)) setProjectId('');
  }, [ready, projectId, projects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (e.ctrlKey || e.metaKey || e.altKey || typing) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // 1–9 jump between views, like switching apps.
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) setView(VIEWS[n - 1]);
    };
    // Stop the browser from navigating away when a file misses a drop zone.
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  const scoped = projectId ? assets.filter((a) => a.projectId === projectId) : assets;
  const count = (id: ToolId) => scoped.filter((a) => a.tool === id).length;

  const handoff = (assetId: string, tool: ToolId) => {
    sendTo(assetId, tool);
    setFlash(tool);
    setTimeout(() => setFlash(null), 700);
  };

  const search = (value: string) => {
    setQuery(value);
    if (value.trim() && view !== 'library') setView('library');
  };

  return (
    <div className="app">
      <nav className="dock" aria-label="Workspaces">
        <button className="dock-brand" onClick={() => setView('overview')} aria-label="Izzad home" title="Izzad">
          <BrandMark size={40} />
        </button>

        <DockItem active={view === 'overview'} label="Home" hint="Home · 1" onClick={() => setView('overview')}>
          <span className="dock-glyph">
            <House size={18} />
          </span>
        </DockItem>
        <DockItem active={view === 'library'} label="Library" hint="Library · 2" onClick={() => setView('library')}>
          <span className="dock-glyph">
            <LayoutGrid size={18} />
          </span>
        </DockItem>

        {STAGES.map((stage) => (
          <div className="dock-group" key={stage}>
            <span className="dock-stage">{stage}</span>
            {TOOLS.filter((t) => t.stage === stage).map((t) => (
              <DropZone key={t.id} className={cx('dock-drop', flash === t.id && 'is-flash')} onAsset={(id) => handoff(id, t.id)}>
                <DockItem
                  active={view === t.id}
                  label={t.short}
                  hint={`${t.name} · ${VIEWS.indexOf(t.id) + 1} — drop a file here to hand it off`}
                  badge={count(t.id)}
                  onClick={() => setView(t.id)}
                >
                  <ToolLogo tool={t} size={36} />
                </DockItem>
              </DropZone>
            ))}
          </div>
        ))}
      </nav>

      <header className="topbar">
        <div className="topbar-left">
          <span className="wordmark">izzad</span>
          <span className="crumb-sep" aria-hidden="true">
            /
          </span>
          <select className="input project-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.client ? ` — ${p.client}` : ''}
              </option>
            ))}
          </select>
        </div>

        <label className="search">
          <Search size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
            placeholder="Search files, tags and notes"
            aria-label="Search the library"
          />
          {query ? (
            <button className="icon-btn icon-btn-sm" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>

        <div className="topbar-right">
          <span className="t-meta topbar-usage">
            {scoped.length} {scoped.length === 1 ? 'file' : 'files'} · {fmtSize(storageBytes(scoped))}
          </span>
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            title={theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="main">
        {ready && (
          <div className="view" key={view}>
            {view === 'overview' ? (
              <Overview projectId={projectId} onOpenTool={setView} onOpenAsset={(a) => setView(a.tool)} />
            ) : view === 'library' ? (
              <Library projectId={projectId} query={query} onClearQuery={() => setQuery('')} />
            ) : (
              <ToolWorkspace tool={toolById(view)} projectId={projectId} onOpenTool={setView} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
