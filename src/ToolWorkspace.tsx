import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Inspector } from './Inspector';
import { AssetRow, DropZone, ToolLogo, UploadButton } from './parts';
import { CanvasStage, CompareStage, GenerateStage, PromptStage, TimelineStage, type StageProps } from './stages';
import { useStore } from './store';
import { nextTool, type Layout, type Tool, type ToolId } from './tools';
import type { Asset, Bin, Origin } from './types';

const STAGE: Record<Layout, (p: StageProps) => JSX.Element> = {
  prompt: PromptStage,
  generate: GenerateStage,
  compare: CompareStage,
  canvas: CanvasStage,
  timeline: TimelineStage,
};

/** Best guess at who made a file, from where it was dropped. Always editable in the inspector. */
function guessOrigin(tool: Tool, bin: Bin, ins: Asset[]): Origin {
  if (bin === 'in') return 'hand';
  const machineInvolved = ins.some((a) => a.origin !== 'hand');
  if (tool.maker === 'human') return machineInvolved ? 'mixed' : 'hand';
  if (tool.id === 'magnific') return ins.length > 0 && !machineInvolved ? 'mixed' : 'ai';
  return 'ai';
}

export function ToolWorkspace({ tool, projectId, onOpenTool }: { tool: Tool; projectId: string; onOpenTool: (id: ToolId) => void }) {
  const { assets, notes, addFiles, updateAsset, sendTo } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inProject = <T extends { projectId: string }>(x: T) => !projectId || x.projectId === projectId;
  const mine = assets.filter((a) => a.tool === tool.id && inProject(a));
  const ins = mine.filter((a) => a.bin === 'in');
  const outs = mine.filter((a) => a.bin === 'out');
  const toolNotes = notes.filter((n) => n.tool === tool.id && inProject(n));
  const selected = mine.find((a) => a.id === selectedId) ?? null;
  const next = nextTool(tool.id);

  const upload = async (files: File[], bin: Bin) => {
    // An output dropped while an input is selected is recorded as made from that input.
    const parentId = bin === 'out' && selected?.bin === 'in' ? selected.id : undefined;
    const created = await addFiles(files, { tool: tool.id, bin, origin: guessOrigin(tool, bin, ins), projectId, parentId });
    if (created[0]) setSelectedId(created[0].id);
  };

  // An asset dragged in from this tool changes bin; from another tool it is a handoff.
  const receive = (id: string, bin: Bin) => {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    if (a.tool === tool.id) updateAsset(id, { bin });
    else sendTo(id, tool.id);
  };

  const Stage = STAGE[tool.layout];

  const bin = (which: Bin, list: Asset[], label: string) => (
    <DropZone className="bin" onFiles={(f) => upload(f, which)} onAsset={(id) => receive(id, which)}>
      <header className="bin-head">
        <div>
          <span className="overline">{which === 'in' ? 'In' : 'Out'}</span>
          <h2 className="t-head">
            {label} <span className="count">{list.length}</span>
          </h2>
        </div>
        <UploadButton className="icon-btn" label={`Add ${label.toLowerCase()}`} onFiles={(f) => upload(f, which)}>
          <Plus size={16} />
        </UploadButton>
      </header>
      <div className="bin-list">
        {list.length === 0 ? (
          <UploadButton className="bin-empty" onFiles={(f) => upload(f, which)}>
            <Plus size={16} />
            <span>Drop files or browse</span>
          </UploadButton>
        ) : (
          list.map((a) => <AssetRow key={a.id} asset={a} selected={a.id === selectedId} onSelect={() => setSelectedId(a.id)} />)
        )}
      </div>
    </DropZone>
  );

  return (
    <div className="workspace">
      <aside className="bins">
        {bin('in', ins, tool.inLabel)}
        {bin('out', outs, tool.outLabel)}
      </aside>

      <section className="center">
        <header className="ws-head">
          <ToolLogo tool={tool} size={44} />
          <div className="ws-title">
            <h1 className="t-title">{tool.name}</h1>
            <p className="t-meta">
              {tool.stage} · {tool.role}
            </p>
          </div>
          <div className="ws-actions">
            {next && (
              <button className="btn btn-ghost ws-next" onClick={() => onOpenTool(next.id)} title={`Next in the flow: ${next.name}`}>
                <span className="t-cap">Next</span>
                <ToolLogo tool={next} size={18} />
                {next.name}
                <ArrowRight size={14} />
              </button>
            )}
            {tool.url ? (
              <a className="btn btn-primary" href={tool.url} target="_blank" rel="noreferrer">
                Open {tool.name} <ArrowUpRight size={15} />
              </a>
            ) : (
              <span className="pill pill-quiet">Opens on your desktop</span>
            )}
          </div>
        </header>
        <Stage tool={tool} ins={ins} outs={outs} notes={toolNotes} selected={selected} onSelect={setSelectedId} upload={upload} projectId={projectId} />
      </section>

      <Inspector asset={selected} onGone={() => setSelectedId(null)}>
        <div className="brief">
          <span className="overline">How {tool.name} fits</span>
          <div className="brief-block">
            <h3 className="t-cap">You decide</h3>
            <p className="brief-lead">{tool.you}</p>
          </div>
          <div className="brief-block">
            <h3 className="t-cap">{tool.name} does</h3>
            <p className="brief-body">{tool.machine}</p>
          </div>
          <div className="brief-block">
            <h3 className="t-cap">Works with</h3>
            <div className="format-list">
              {tool.formats.map((f) => (
                <span key={f} className="format">
                  {f}
                </span>
              ))}
            </div>
          </div>
          <p className="brief-tip">
            Bring files in on the left, drop what you made into <strong>{tool.outLabel}</strong>. Drag any file onto another tool in the dock to hand it
            off — the link to its source is kept.
          </p>
        </div>
      </Inspector>
    </div>
  );
}
