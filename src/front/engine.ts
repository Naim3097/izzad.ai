// The seam between this page and the automation engine.
//
// The page only ever talks to an `Engine`. Until the real one exists, `previewEngine` stands in: it
// walks the same stages so the whole funnel can be seen and tested, but it reads nothing, renders
// nothing and sends nothing anywhere, and the page says so on screen. To go live, implement `Engine`
// against the real service (keys stay server-side) and export it as `engine` at the bottom.

import { STAGES, type Stage } from '../tools';

export type AssetKind = 'poster' | 'social' | 'kit' | 'logo';

/** What the visitor asked for: a site to read, or a brief in their own words. */
export interface Brief {
  kind: AssetKind;
  url?: string;
  prompt?: string;
}

export interface Asset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** The finished file. Absent until it has been rendered. */
  url?: string;
}

export type RunEvent =
  | { type: 'stage'; stage: Stage; note: string }
  | { type: 'asset'; asset: Asset }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface Engine {
  /** True for the stand-in. The page labels every run and never claims work was done. */
  preview: boolean;
  /** Runs one brief, reporting as it goes. Resolves after 'done' or 'error'. Must honour `signal`. */
  run(brief: Brief, onEvent: (e: RunEvent) => void, signal: AbortSignal): Promise<void>;
  /** The conversion: a visitor who has had their free pair asks to keep going. */
  lead(email: string, brief: Brief | null): Promise<void>;
}

/** How many pieces a visitor gets before the gate, and their size per kind. */
export const FREE_PIECES = 2;
export const SIZES: Record<AssetKind, { width: number; height: number; name: string }> = {
  poster: { width: 1080, height: 1350, name: 'Poster' },
  social: { width: 1080, height: 1080, name: 'Post' },
  kit: { width: 1600, height: 1000, name: 'Board' },
  logo: { width: 1000, height: 1000, name: 'Mark' },
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const previewEngine: Engine = {
  preview: true,
  async run(brief, onEvent, signal) {
    const subject = brief.url ? new URL(brief.url).hostname.replace(/^www\./, '') : 'your brief';
    const size = SIZES[brief.kind];
    const steps: Record<Stage, string> = {
      Think: brief.url ? `Read ${subject}. Pull the colours, type and tone.` : 'Read the brief. Set the angle and the copy.',
      Generate: 'Generate the visuals in the brand’s look, then upscale.',
      Craft: 'Set the type and the layout.',
      Cut: `Export ${FREE_PIECES} at ${size.width}×${size.height}.`,
    };
    try {
      for (const [i, stage] of STAGES.entries()) {
        onEvent({ type: 'stage', stage, note: `Step ${i + 1} of ${STAGES.length}. ${steps[stage]}` });
        await wait(1500, signal);
      }
      for (let i = 1; i <= FREE_PIECES; i++) {
        onEvent({ type: 'asset', asset: { id: `preview-${i}`, label: `${size.name} ${i}`, width: size.width, height: size.height } });
        await wait(260, signal);
      }
      onEvent({ type: 'done' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') onEvent({ type: 'error', message: 'The run stopped before it finished.' });
    }
  },
  async lead() {
    // Nothing is stored or sent from the stand-in. The page tells the visitor as much.
  },
};

export const engine: Engine = previewEngine;
