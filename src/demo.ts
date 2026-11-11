// Placeholder content so the workspace can be explored before real files go in.
// Everything is drawn on a canvas in the browser; nothing is fetched.

import type { NewFileOpts } from './store';
import type { ToolId } from './tools';
import type { Asset, Note, Project } from './types';

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const PALETTES = [
  ['#0D0B1F', '#3D2C8D', '#916BBF', '#F2A65A', '#FFE3C2'],
  ['#08121C', '#12355B', '#2D82B7', '#42E2B8', '#F3DFBF'],
  ['#1A0B12', '#7A1E48', '#E4572E', '#F3A712', '#F7E3D4'],
  ['#0C1412', '#1F4D43', '#5FAD8E', '#D7E8BA', '#F25F5C'],
  ['#12101C', '#2B2D6E', '#6C63FF', '#FF7EB6', '#FFD6E8'],
];

/** A soft abstract study: blurred colour fields with a few crisp marks on top. */
function paint(c: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const r = rng(seed);
  const palette = PALETTES[seed % PALETTES.length];
  const unit = Math.min(w, h);
  // The colour field is soft, so paint it small and scale it up: far cheaper than a full-size blur.
  const k = Math.min(1, 200 / unit);
  const field = document.createElement('canvas');
  field.width = Math.max(8, Math.round(w * k));
  field.height = Math.max(8, Math.round(h * k));
  const f = field.getContext('2d')!;
  const fu = unit * k;
  f.fillStyle = palette[0];
  f.fillRect(0, 0, field.width, field.height);
  f.filter = `blur(${Math.max(1, Math.round(fu * 0.09))}px)`;
  for (let i = 0; i < 7; i++) {
    f.fillStyle = palette[1 + Math.floor(r() * (palette.length - 1))];
    f.globalAlpha = 0.55 + r() * 0.4;
    f.beginPath();
    f.ellipse(r() * field.width, r() * field.height, (0.18 + r() * 0.3) * fu, (0.14 + r() * 0.26) * fu, r() * Math.PI, 0, Math.PI * 2);
    f.fill();
  }
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(field, 0, 0, w, h);
  // Crisp detail, so a low-resolution copy visibly loses something.
  c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.lineWidth = Math.max(1, unit * 0.004);
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(r() * w, r() * h, (0.1 + r() * 0.28) * unit, r() * Math.PI, r() * Math.PI + Math.PI * (0.5 + r()));
    c.stroke();
  }
  c.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 24; i++) {
    c.beginPath();
    c.arc(r() * w, r() * h, unit * (0.002 + r() * 0.004), 0, Math.PI * 2);
    c.fill();
  }
}

function drawPng(name: string, seed: number, w: number, h: number, detail = 1): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const out = canvas.getContext('2d')!;
  if (detail >= 1) {
    paint(out, w, h, seed);
  } else {
    // Render small and scale up without smoothing: a stand-in for a low-resolution original.
    const small = document.createElement('canvas');
    small.width = Math.max(8, Math.round(w * detail));
    small.height = Math.max(8, Math.round(h * detail));
    paint(small.getContext('2d')!, small.width, small.height, seed);
    out.imageSmoothingEnabled = false;
    out.drawImage(small, 0, 0, w, h);
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob!], name, { type: 'image/png' })), 'image/png'));
}

function svgFile(name: string, inner: string): File {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#F4F1EA"/>${inner}</svg>`;
  return new File([svg], name, { type: 'image/svg+xml' });
}

interface Api {
  addFiles: (files: File[], opts: NewFileOpts) => Promise<Asset[]>;
  addNote: (n: Omit<Note, 'id' | 'createdAt'> & { createdAt?: number }) => void;
  addProject: (p: Omit<Project, 'id' | 'createdAt'>) => Project;
}

export async function loadDemo({ addFiles, addNote, addProject }: Api) {
  const now = Date.now();
  const due = (days: number) => new Date(now + days * DAY).toISOString().slice(0, 10);
  const reels = addProject({ name: 'Launch reels', client: 'Kopi Satu', status: 'ACTIVE', due: due(9) });
  const identity = addProject({ name: 'Identity system', client: 'Atlas Studio', status: 'REVIEW', due: due(3) });

  const add = async (
    file: File,
    tool: ToolId,
    bin: 'in' | 'out',
    origin: Asset['origin'],
    daysAgo: number,
    projectId: string,
    parentId?: string,
  ) => (await addFiles([file], { tool, bin, origin, projectId, parentId, createdAt: now - daysAgo * DAY, tags: ['sample'] }))[0];

  await add(await drawPng('moodboard-ref.png', 3, 960, 720), 'chatgpt', 'in', 'hand', 9, reels.id);

  await add(await drawPng('hero-take-01.png', 11, 720, 900), 'higgsfield', 'out', 'ai', 7, reels.id);
  const pick = await add(await drawPng('hero-take-02.png', 12, 720, 900), 'higgsfield', 'out', 'ai', 7, reels.id);
  await add(await drawPng('hero-take-03.png', 13, 720, 900), 'higgsfield', 'out', 'ai', 6, reels.id);

  const low = await add(await drawPng('hero-take-02.png', 12, 720, 900, 0.07), 'magnific', 'in', 'ai', 5, reels.id, pick.id);
  const up = await add(await drawPng('hero-take-02-4x.png', 12, 720, 900), 'magnific', 'out', 'ai', 5, reels.id, low.id);

  const psIn = await add(await drawPng('hero-take-02-4x.png', 12, 720, 900), 'photoshop', 'in', 'ai', 4, reels.id, up.id);
  const psOut = await add(await drawPng('hero-retouch-final.png', 24, 720, 900), 'photoshop', 'out', 'mixed', 3, reels.id, psIn.id);

  await add(
    svgFile('atlas-mark.svg', '<circle cx="200" cy="200" r="118" fill="#17161B"/><rect x="171" y="82" width="58" height="236" fill="#F4F1EA"/>'),
    'illustrator',
    'out',
    'hand',
    8,
    identity.id,
  );
  await add(
    svgFile(
      'atlas-lockup.svg',
      '<circle cx="112" cy="200" r="52" fill="#17161B"/><rect x="99" y="148" width="26" height="104" fill="#F4F1EA"/><rect x="188" y="170" width="150" height="26" rx="3" fill="#17161B"/><rect x="188" y="210" width="96" height="14" rx="3" fill="#8A8792"/>',
    ),
    'illustrator',
    'out',
    'hand',
    2,
    identity.id,
  );

  await add(await drawPng('shot-01.png', 31, 540, 960), 'capcut', 'in', 'mixed', 1, reels.id, psOut.id);
  await add(await drawPng('shot-02.png', 32, 540, 960), 'capcut', 'in', 'ai', 1, reels.id);
  await add(await drawPng('shot-03.png', 33, 540, 960), 'capcut', 'in', 'hand', 1, reels.id);
  await add(await drawPng('reel-cover.png', 34, 540, 960), 'capcut', 'out', 'mixed', 0, reels.id);

  addNote({
    tool: 'chatgpt',
    projectId: reels.id,
    title: 'Brief to three directions',
    body: 'Here is the client brief: [paste].\n\nGive me three distinct visual directions. For each: a one-line idea, the palette, reference photographers, and what it must not look like.',
    createdAt: now - 9 * DAY,
  });
  addNote({
    tool: 'higgsfield',
    projectId: reels.id,
    title: 'Hero — slow push-in',
    body: 'Slow push-in on a ceramic cup on raw concrete, hard morning side-light, steam, 35mm, shallow depth of field, warm muted grade.',
    createdAt: now - 7 * DAY,
  });
  addNote({
    tool: 'claude',
    projectId: '',
    title: 'Batch export sizes',
    body: 'Write a script that takes every PNG in ./exports and writes 1080x1920, 1080x1350 and 1080x1080 crops to ./social, named <file>-<ratio>.png.',
    createdAt: now - 2 * DAY,
  });
}
