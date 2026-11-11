import { ArrowDownToLine, CornerDownRight, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ConfirmButton, KIND_LABEL, Segmented, Thumb, ToolLogo, ext, fmtDateTime, fmtSize, kindOf } from './parts';
import { downloadAsset, useStore } from './store';
import { TOOLS, toolById } from './tools';
import { ORIGINS, ORIGIN_LABEL, type Asset } from './types';

/** Right-hand panel: everything about the selected asset, and where it can go next. */
export function Inspector({ asset, onGone, children }: { asset: Asset | null; onGone: () => void; children?: ReactNode }) {
  const { assets, projects, updateAsset, removeAsset, sendTo } = useStore();

  if (!asset) return <aside className="inspector">{children}</aside>;

  const parent = asset.parentId ? assets.find((a) => a.id === asset.parentId) : undefined;
  const usedIn = Array.from(new Set(assets.filter((a) => a.parentId === asset.id).map((a) => a.tool))).map(toolById);
  const tool = toolById(asset.tool);
  const format = (ext(asset.name) || 'file').toUpperCase();

  return (
    <aside className="inspector" key={asset.id}>
      <div className="insp-scroll">
        <div className="insp-preview">
          <Thumb asset={asset} fit="contain" controls />
          <button className="icon-btn insp-close" onClick={onGone} aria-label="Close details" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="insp-title">
          <input
            className="insp-name"
            defaultValue={asset.name}
            aria-label="File name"
            spellCheck={false}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== asset.name) updateAsset(asset.id, { name: v });
              else e.target.value = asset.name;
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <p className="t-meta">
            {format} {KIND_LABEL[kindOf(asset)].toLowerCase()} · {fmtSize(asset.size)} · {fmtDateTime(asset.createdAt)}
          </p>
        </div>

        <section className="insp-section">
          <h3 className="overline">Where it lives</h3>
          <div className="lineage">
            {parent && (
              <div className="lineage-row">
                <ToolLogo tool={toolById(parent.tool)} size={22} />
                <span className="lineage-text">
                  <span className="t-cap">Made from</span>
                  <span className="lineage-name">{parent.name}</span>
                </span>
              </div>
            )}
            <div className={parent ? 'lineage-row is-child' : 'lineage-row'}>
              {parent && <CornerDownRight size={14} className="lineage-elbow" />}
              <ToolLogo tool={tool} size={22} />
              <span className="lineage-text">
                <span className="t-cap">
                  {tool.name} · {asset.bin === 'in' ? tool.inLabel : tool.outLabel}
                </span>
                <span className="lineage-name">{asset.name}</span>
              </span>
            </div>
            {usedIn.length > 0 && (
              <div className="lineage-used">
                <span className="t-cap">Handed to</span>
                {usedIn.map((t) => (
                  <span key={t.id} title={t.name}>
                    <ToolLogo tool={t} size={18} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="insp-section">
          <h3 className="overline">Made by</h3>
          <Segmented
            label="Made by"
            value={asset.origin}
            options={ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABEL[o] }))}
            onChange={(origin) => updateAsset(asset.id, { origin })}
          />
        </section>

        <section className="insp-section insp-fields">
          <label className="field">
            <span className="overline">Project</span>
            <select className="input" value={asset.projectId} onChange={(e) => updateAsset(asset.id, { projectId: e.target.value })}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="overline">Tags</span>
            <input
              className="input"
              placeholder="hero, v2, approved"
              defaultValue={asset.tags.join(', ')}
              onBlur={(e) =>
                updateAsset(asset.id, {
                  tags: e.target.value
                    .split(',')
                    .map((t) => t.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="field">
            <span className="overline">Note</span>
            <textarea
              className="input"
              rows={2}
              placeholder="What is this for?"
              defaultValue={asset.note}
              onBlur={(e) => {
                if (e.target.value !== asset.note) updateAsset(asset.id, { note: e.target.value });
              }}
            />
          </label>
        </section>

        <section className="insp-section">
          <h3 className="overline">Send to</h3>
          <div className="send-grid">
            {TOOLS.filter((t) => t.id !== asset.tool).map((t) => (
              <button key={t.id} className="send-btn" onClick={() => sendTo(asset.id, t.id)} title={`Hand off to ${t.name}`}>
                <ToolLogo tool={t} size={22} />
                <span>{t.short}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="insp-foot">
        <button className="btn btn-primary btn-grow" onClick={() => downloadAsset(asset)}>
          <ArrowDownToLine size={15} /> Download
        </button>
        <button
          className="btn"
          onClick={() => updateAsset(asset.id, { bin: asset.bin === 'in' ? 'out' : 'in' })}
          title={`Move to ${asset.bin === 'in' ? tool.outLabel : tool.inLabel}`}
        >
          Move to {asset.bin === 'in' ? tool.outLabel : tool.inLabel}
        </button>
        <ConfirmButton
          className="icon-btn icon-btn-danger"
          label="Delete file"
          confirmLabel="Delete?"
          onConfirm={() => {
            removeAsset(asset.id);
            onGone();
          }}
        >
          <Trash2 size={15} />
        </ConfirmButton>
      </div>
    </aside>
  );
}
