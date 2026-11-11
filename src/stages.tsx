import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, Film, ImagePlus, MessageSquareText, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { AssetTile, ConfirmButton, DropZone, Empty, Segmented, Thumb, canPreview, cx, fmtDate } from './parts';
import { useStore } from './store';
import type { Tool } from './tools';
import type { Asset, Bin, Note } from './types';

// The centre of a workspace. Each tool picks one of these via `layout` in tools.ts,
// so the screen reshapes itself when you move between tools.

export interface StageProps {
  tool: Tool;
  ins: Asset[];
  outs: Asset[];
  notes: Note[];
  selected: Asset | null;
  onSelect: (id: string | null) => void;
  upload: (files: File[], bin: Bin) => void;
  projectId: string;
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };
  return [copied, copy];
}

// ---- shared: the prompt bar ------------------------------------------------

function Composer({ tool, projectId }: { tool: Tool; projectId: string }) {
  const { addNote } = useStore();
  const [body, setBody] = useState('');
  const isCode = tool.id === 'claude';
  const text = body.trim();

  const save = () => {
    if (!text) return;
    const firstLine = text.split('\n')[0];
    addNote({ tool: tool.id, title: firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine, body: text, projectId });
    setBody('');
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          rows={2}
          className={cx(isCode && 'is-mono')}
          placeholder={isCode ? 'Write a command or a spec worth keeping…' : `Write a prompt for ${tool.name}…`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          }}
        />
        <div className="composer-bar">
          <span className="t-cap">
            Saved here, run in {tool.name}. <kbd>Ctrl</kbd> <kbd>↵</kbd> to save
          </span>
          <button className="btn btn-ghost" disabled={!text} onClick={save}>
            Save
          </button>
          {tool.url && (
            <button
              className="btn btn-primary"
              disabled={!text}
              onClick={() => {
                navigator.clipboard?.writeText(text).catch(() => {});
                save();
                window.open(tool.url, '_blank', 'noopener');
              }}
            >
              Copy &amp; open <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteCard({ note, mono }: { note: Note; mono: boolean }) {
  const { removeNote } = useStore();
  const [copied, copy] = useCopied();
  return (
    <article className="note">
      <header className="note-head">
        <h3 className="note-title">{note.title}</h3>
        <span className="t-cap">{fmtDate(note.createdAt)}</span>
        <button className="icon-btn" onClick={() => copy(note.body)} aria-label="Copy" title={copied ? 'Copied' : 'Copy'}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <ConfirmButton className="icon-btn icon-btn-danger" label="Delete" confirmLabel="Delete?" onConfirm={() => removeNote(note.id)}>
          <Trash2 size={15} />
        </ConfirmButton>
      </header>
      <pre className={cx('note-body', mono && 'is-mono')}>{note.body}</pre>
    </article>
  );
}

// ---- PROMPT: ChatGPT, Claude Code -------------------------------------------

export function PromptStage({ tool, notes, projectId, upload }: StageProps) {
  const isCode = tool.id === 'claude';
  return (
    <DropZone className="stage stage-prompt" onFiles={(f) => upload(f, 'in')}>
      <div className="stage-scroll">
        <div className="prompt-col">
          {notes.length === 0 ? (
            <Empty
              icon={<MessageSquareText size={22} />}
              title={isCode ? 'No saved commands yet' : 'No saved prompts yet'}
              hint="Keep the ones that worked. A prompt you can reuse is an asset like any other."
            />
          ) : (
            notes.map((n) => <NoteCard key={n.id} note={n} mono={isCode} />)
          )}
        </div>
      </div>
      <Composer tool={tool} projectId={projectId} />
    </DropZone>
  );
}

// ---- GENERATE: Higgsfield ---------------------------------------------------

function PromptChip({ note }: { note: Note }) {
  const [copied, copy] = useCopied();
  return (
    <button className="chip" title={note.body} onClick={() => copy(note.body)}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : note.title}</span>
    </button>
  );
}

export function GenerateStage({ tool, outs, notes, selected, onSelect, upload, projectId }: StageProps) {
  return (
    <div className="stage stage-generate">
      <DropZone className="stage-scroll" onFiles={(f) => upload(f, 'out')}>
        {outs.length === 0 ? (
          <Empty icon={<ImagePlus size={22} />} title="No generations yet" hint={`Drop what you kept from ${tool.name}. Keep the picks, not the pile.`} />
        ) : (
          <div className="grid grid-lg">
            {outs.map((a) => (
              <AssetTile key={a.id} asset={a} selected={selected?.id === a.id} onSelect={() => onSelect(a.id)} />
            ))}
          </div>
        )}
      </DropZone>
      {notes.length > 0 && (
        <div className="chip-row">
          <span className="t-cap">Saved prompts</span>
          <div className="chip-list">
            {notes.map((n) => (
              <PromptChip key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}
      <Composer tool={tool} projectId={projectId} />
    </div>
  );
}

// ---- COMPARE: Magnific ------------------------------------------------------

export function CompareStage({ tool, ins, outs, selected, upload }: StageProps) {
  const [split, setSplit] = useState(50);

  let before: Asset | undefined;
  let after: Asset | undefined;
  if (selected?.bin === 'in') {
    before = selected;
    after = outs.find((o) => o.parentId === selected.id) ?? outs[0];
  } else {
    after = selected ?? outs[0];
    before = (after?.parentId && ins.find((i) => i.id === after!.parentId)) || ins[0];
  }

  if (before && after && canPreview(before) && canPreview(after)) {
    return (
      <div className="stage stage-compare">
        <div className="compare" style={{ '--split': `${split}%` } as CSSProperties}>
          <div className="compare-layer">
            <Thumb asset={after} fit="contain" />
          </div>
          <div className="compare-layer compare-before">
            <Thumb asset={before} fit="contain" />
          </div>
          <div className="compare-handle">
            <span className="compare-knob">
              <ChevronLeft size={14} />
              <ChevronRight size={14} />
            </span>
          </div>
          <span className="pill compare-tag compare-tag-l">Before</span>
          <span className="pill compare-tag compare-tag-r">After</span>
          <input
            className="compare-range"
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            aria-label="Before and after split"
          />
        </div>
        <div className="compare-names">
          <span className="t-meta ellipsis">{before.name}</span>
          <span className="t-cap">Drag to compare</span>
          <span className="t-meta ellipsis">{after.name}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stage stage-compare">
      <div className="compare-split">
        <DropZone className="compare-pane" onFiles={(f) => upload(f, 'in')}>
          <span className="pill">Before</span>
          {before ? <Thumb asset={before} fit="contain" /> : <Empty title="Drop the original" hint={`What goes into ${tool.name}.`} />}
        </DropZone>
        <DropZone className="compare-pane" onFiles={(f) => upload(f, 'out')}>
          <span className="pill">After</span>
          {after ? <Thumb asset={after} fit="contain" /> : <Empty title="Drop the result" hint="Select the original first and the two are linked." />}
        </DropZone>
      </div>
    </div>
  );
}

// ---- CANVAS: Photoshop, Illustrator -----------------------------------------

export function CanvasStage({ tool, ins, outs, selected, onSelect, upload }: StageProps) {
  const all = [...outs, ...ins];
  const linking = selected?.bin === 'in';
  return (
    <div className="stage stage-canvas">
      <DropZone className="viewport" onFiles={(f) => upload(f, linking ? 'out' : 'in')}>
        {selected ? (
          <div className="viewport-art">
            <Thumb asset={selected} fit="contain" controls />
          </div>
        ) : (
          <Empty
            icon={<ImagePlus size={22} />}
            title={`Nothing open in ${tool.name}`}
            hint={`Drop a source file. Download it, work it in ${tool.name}, then drop the export back.`}
          />
        )}
        <span className="pill viewport-hint">{linking ? `Drop the export — it links to ${selected!.name}` : 'Drop a file to add it as a source'}</span>
      </DropZone>
      {all.length > 0 && (
        <div className="filmstrip">
          {all.map((a) => (
            <button key={a.id} className={cx('film', selected?.id === a.id && 'is-selected')} onClick={() => onSelect(a.id)} title={a.name}>
              <Thumb asset={a} />
              <span className="film-bin">{a.bin === 'in' ? 'In' : 'Out'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- TIMELINE: CapCut -------------------------------------------------------

const ASPECTS = [
  { value: '9 / 16', label: '9:16' },
  { value: '4 / 5', label: '4:5' },
  { value: '1 / 1', label: '1:1' },
  { value: '16 / 9', label: '16:9' },
];

export function TimelineStage({ tool, ins, selected, onSelect, upload }: StageProps) {
  const { updateAsset } = useStore();
  const [aspect, setAspect] = useState(ASPECTS[0].value);

  // Sequence order: explicit seq first, otherwise the order clips arrived in.
  const sequence = ins.slice().sort((a, b) => (a.seq ?? a.createdAt) - (b.seq ?? b.createdAt));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sequence.length) return;
    const next = sequence.slice();
    [next[index], next[target]] = [next[target], next[index]];
    next.forEach((a, i) => {
      if (a.seq !== i) updateAsset(a.id, { seq: i });
    });
  };

  return (
    <div className="stage stage-timeline">
      <DropZone className="viewport" onFiles={(f) => upload(f, 'in')}>
        <div className="frame" style={{ aspectRatio: aspect }}>
          {selected ? <Thumb asset={selected} fit="cover" controls /> : <Empty icon={<Film size={22} />} title="No clip selected" hint="Pick a clip below, or drop new ones." />}
        </div>
        <div className="viewport-tools">
          <Segmented label="Frame" value={aspect} options={ASPECTS} onChange={setAspect} />
        </div>
      </DropZone>
      <div className="timeline">
        <div className="timeline-head">
          <h3 className="t-head">Sequence</h3>
          <span className="t-meta">
            {sequence.length} {sequence.length === 1 ? 'clip' : 'clips'} · the order is your edit plan for {tool.name}
          </span>
        </div>
        <div className="timeline-track">
          {sequence.length === 0 ? (
            <span className="t-meta timeline-empty">Send clips here from any tool, or drop files above.</span>
          ) : (
            sequence.map((a, i) => (
              <div key={a.id} className={cx('clip', selected?.id === a.id && 'is-selected')}>
                <button className="clip-media" onClick={() => onSelect(a.id)} title={a.name}>
                  <Thumb asset={a} />
                  <span className="clip-n">{i + 1}</span>
                </button>
                <div className="clip-ctl">
                  <button className="icon-btn icon-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${a.name} earlier`}>
                    <ChevronLeft size={14} />
                  </button>
                  <span className="clip-name">{a.name}</span>
                  <button className="icon-btn icon-btn-sm" disabled={i === sequence.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${a.name} later`}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
