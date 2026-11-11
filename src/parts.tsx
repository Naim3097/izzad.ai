import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import brandLogo from './assets/brand/izzad-logo.webp';
import { useBlobUrl } from './store';
import { toolById, type Tool } from './tools';
import { ORIGIN_LABEL, type Asset, type Origin } from './types';

export const ASSET_MIME = 'application/x-izzad-asset';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Below this width the details panel stops being a column and becomes a sheet over the work. Mirrors styles.css. */
export const COMPACT = '(max-width: 1024px)';

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtDateTime(t: number): string {
  const d = new Date(t);
  return `${fmtDate(t)}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export type Kind = 'image' | 'video' | 'audio' | 'vector' | 'design' | 'text' | 'other';

export const KIND_LABEL: Record<Kind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  vector: 'Vector',
  design: 'Design file',
  text: 'Text',
  other: 'File',
};

const BY_EXT: Record<string, Kind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio',
  svg: 'vector', ai: 'vector', eps: 'vector',
  psd: 'design', psb: 'design', tif: 'design', tiff: 'design', pdf: 'design', indd: 'design',
  txt: 'text', md: 'text', json: 'text', js: 'text', ts: 'text', py: 'text', csv: 'text', html: 'text', css: 'text',
};

export function kindOf(a: Pick<Asset, 'name' | 'mime'>): Kind {
  const byExt = BY_EXT[ext(a.name)];
  if (byExt) return byExt;
  if (a.mime.startsWith('image/')) return 'image';
  if (a.mime.startsWith('video/')) return 'video';
  if (a.mime.startsWith('audio/')) return 'audio';
  if (a.mime.startsWith('text/')) return 'text';
  return 'other';
}

/** Can the browser render this file itself? PSD / AI / EPS cannot be. */
export function canPreview(a: Pick<Asset, 'name' | 'mime'>): boolean {
  const k = kindOf(a);
  return k === 'image' || k === 'video' || ext(a.name) === 'svg';
}

// ---- brand -----------------------------------------------------------------

/** The Izzad logo: the round character mark, cut out of its backdrop. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return <img className="brandmark" src={brandLogo} width={size} height={size} alt="" draggable={false} />;
}

/** A tool's real logo on an app-icon tile. */
export function ToolLogo({ tool, size = 36 }: { tool: Tool; size?: number }) {
  const { logo } = tool;
  return (
    <span className="logo" style={{ width: size, height: size, background: logo.bg, borderRadius: Math.round(size * 0.235) }}>
      <img
        src={logo.src}
        alt=""
        draggable={false}
        style={{
          padding: logo.inset ? `${logo.inset * 100}%` : 0,
          objectFit: logo.inset ? 'contain' : 'cover',
          filter: logo.invert ? 'invert(1)' : undefined,
        }}
      />
    </span>
  );
}

// ---- media -----------------------------------------------------------------

export function Thumb({ asset, fit = 'cover', controls = false }: { asset: Asset; fit?: 'cover' | 'contain'; controls?: boolean }) {
  const previewable = canPreview(asset);
  const url = useBlobUrl(previewable ? asset.blobId : undefined);
  const style: CSSProperties = { objectFit: fit };
  if (previewable && url) {
    if (kindOf(asset) === 'video') {
      return <video className="media" src={url} style={style} muted={!controls} controls={controls} preload="metadata" playsInline />;
    }
    return <img className="media" src={url} style={style} alt={asset.name} draggable={false} />;
  }
  return (
    <div className="media media-ext">
      <span>{(ext(asset.name) || 'file').toUpperCase()}</span>
    </div>
  );
}

export function OriginBadge({ origin }: { origin: Origin }) {
  return <span className={cx('origin', `origin-${origin}`)}>{ORIGIN_LABEL[origin]}</span>;
}

// ---- drag and drop ---------------------------------------------------------

/** Drop target for files from the desktop and for assets dragged inside the app. */
export function DropZone({
  onFiles,
  onAsset,
  className,
  children,
}: {
  onFiles?: (files: File[]) => void;
  onAsset?: (id: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return (onAsset && types.includes(ASSET_MIME)) || (onFiles && types.includes('Files'));
  };
  return (
    <div
      className={cx(className, over && 'is-over')}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(ASSET_MIME);
        if (id) {
          onAsset?.(id);
          return;
        }
        if (e.dataTransfer.files.length) onFiles?.(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
    </div>
  );
}

export function UploadButton({
  onFiles,
  className = 'btn',
  label,
  children,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()} aria-label={label} title={label}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Start dragging an asset: inside the app it is a handoff, in Chromium it can also be dropped on the desktop. */
export function dragAsset(e: DragEvent, asset: Asset, url: string | null) {
  e.dataTransfer.setData(ASSET_MIME, asset.id);
  e.dataTransfer.effectAllowed = 'copyMove';
  if (url) e.dataTransfer.setData('DownloadURL', `${asset.mime || 'application/octet-stream'}:${asset.name}:${url}`);
}

// ---- asset views -----------------------------------------------------------

export function AssetRow({ asset, selected, onSelect }: { asset: Asset; selected: boolean; onSelect: () => void }) {
  const url = useBlobUrl(asset.blobId);
  return (
    <button
      className={cx('row', selected && 'is-selected')}
      draggable
      onDragStart={(e) => dragAsset(e, asset, url)}
      onClick={onSelect}
      title={asset.name}
    >
      <span className="row-thumb">
        <Thumb asset={asset} />
      </span>
      <span className="row-text">
        <span className="row-name">{asset.name}</span>
        <span className="row-meta">{fmtSize(asset.size)}</span>
      </span>
      <OriginBadge origin={asset.origin} />
    </button>
  );
}

export function AssetTile({
  asset,
  selected,
  onSelect,
  showTool = false,
}: {
  asset: Asset;
  selected: boolean;
  onSelect: () => void;
  showTool?: boolean;
}) {
  const url = useBlobUrl(asset.blobId);
  const tool = toolById(asset.tool);
  return (
    <button
      className={cx('tile', selected && 'is-selected')}
      draggable
      onDragStart={(e) => dragAsset(e, asset, url)}
      onClick={onSelect}
      title={asset.name}
    >
      <span className="tile-media">
        <Thumb asset={asset} />
        {showTool && (
          <span className="tile-tool">
            <ToolLogo tool={tool} size={22} />
          </span>
        )}
      </span>
      <span className="tile-cap">
        <span className="tile-name">{asset.name}</span>
        <span className="tile-meta">
          <span className="tile-where">{showTool ? `${tool.name} · ${asset.bin === 'in' ? tool.inLabel : tool.outLabel}` : fmtSize(asset.size)}</span>
          <OriginBadge origin={asset.origin} />
        </span>
      </span>
    </button>
  );
}

// ---- controls --------------------------------------------------------------

/** Segmented control with a thumb that slides to the selection. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': index } as CSSProperties}>
      <span className="seg-thumb" />
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={cx('seg-btn', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Two-step destructive action: the first click arms it, the second fires. */
export function ConfirmButton({
  onConfirm,
  className = 'btn',
  confirmLabel = 'Confirm',
  label,
  children,
}: {
  onConfirm: () => void;
  className?: string;
  confirmLabel?: string;
  label?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={cx(className, armed && 'is-armed')}
      aria-label={armed ? confirmLabel : label}
      title={armed ? confirmLabel : label}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function Empty({ icon, title, hint, children }: { icon?: ReactNode; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children}
    </div>
  );
}
