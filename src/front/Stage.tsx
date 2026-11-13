// The stage: one full-bleed canvas holding the wall, the lettering, the avatar and its smoke.
// Until the model is in (or if WebGL is not available) the same picture is laid out flat in CSS beneath it.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import avatarUrl from './assets/avatar.glb?url';
import posterUrl from './assets/avatar-poster.webp';
import lettersUrl from './assets/izzad-letters.webp';
import smokeUrl from './assets/smoke.glb?url';
import wallUrl from './assets/wall.webp';
import type { AvatarScene, Gesture } from './avatar/AvatarScene';

export interface StageHandle {
  perform: (gesture: Gesture) => void;
  hop: () => void;
  nod: () => void;
  /** Look straight out at the visitor for a moment. */
  face: (seconds?: number) => void;
  /** Where a part of the avatar is on screen, in client pixels. Null until the model is in. */
  anchor: (part: 'hand' | 'head') => { x: number; y: number } | null;
  /** Spray somewhere on the open wall, unprompted. */
  tag: () => void;
  /** Spray an element on the page. `onLand` fires when paint reaches it, or at once if there is no avatar to do it. */
  sprayOn: (el: Element, onLand: () => void) => void;
  /** Turn toward a point on screen (client pixels), or pass null to face front. */
  attend: (at: { x: number; y: number } | null) => void;
}

interface Props {
  /** The block of interface along the bottom edge; the character is framed in the space above it. */
  below: RefObject<HTMLElement>;
  onPoke: () => void;
  onSpray: () => void;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BAR = 56;
/** The can never sprays the same colour twice running. */
const PAINTS = ['#f26a1b', '#efe9df', '#f5b31a', '#8fe0cf'];

export const Stage = forwardRef<StageHandle, Props>(function Stage({ below, onPoke, onSpray }, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AvatarScene | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'flat'>('loading');
  const [over, setOver] = useState<'avatar' | 'wall'>('wall');
  const paint = useRef(0);
  const handlers = useRef({ onPoke, onSpray });
  handlers.current = { onPoke, onSpray };

  useImperativeHandle(
    ref,
    () => ({
      perform: (gesture) => sceneRef.current?.perform(gesture),
      hop: () => sceneRef.current?.hop(),
      nod: () => sceneRef.current?.nod(),
      face: (seconds) => sceneRef.current?.face(seconds),
      anchor: (part) => {
        const at = sceneRef.current?.anchor(part);
        const stage = stageRef.current;
        if (!at || !stage) return null;
        const r = stage.getBoundingClientRect();
        return { x: r.left + at.x, y: r.top + at.y };
      },
      sprayOn: (el, onLand) => {
        const scene = sceneRef.current;
        const stage = stageRef.current;
        if (!scene || !stage) return onLand();
        const r = stage.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        const sent = scene.sprayAt(t.left + t.width / 2 - r.left, t.top + t.height / 2 - r.top, PAINTS[paint.current++ % PAINTS.length], { mark: false, onLand });
        if (!sent) onLand();
      },
      tag: () => {
        const scene = sceneRef.current;
        const stage = stageRef.current;
        if (!scene || !stage) return;
        const r = stage.getBoundingClientRect();
        const x = Math.random() < 0.5 ? 0.08 + Math.random() * 0.2 : 0.72 + Math.random() * 0.2;
        if (scene.sprayAt(r.width * x, r.height * (0.12 + Math.random() * 0.24), PAINTS[paint.current % PAINTS.length])) paint.current++;
      },
      attend: (at) => {
        const scene = sceneRef.current;
        const stage = stageRef.current;
        if (!scene || !stage) return;
        if (!at) return scene.setFocus(0, 0);
        const r = stage.getBoundingClientRect();
        scene.setFocus((at.x - (r.left + r.width / 2)) / (r.width / 2), -(at.y - (r.top + r.height * 0.4)) / (r.height / 2));
      },
    }),
    [],
  );

  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    let scene: AvatarScene | null = null;
    let dead = false;

    // Seat the character in the room between the top bar and the interface along the bottom.
    const frame = () => {
      const s = stage.getBoundingClientRect();
      const floor = below.current ? below.current.getBoundingClientRect().top - s.top : s.height * 0.72;
      const room = Math.max(160, floor - BAR);
      // On a wide screen the whole burst of smoke fits; on a narrow one the character leads and the smoke runs off the edges.
      const tall = clamp(Math.min(room * 0.93, s.width * (s.width < 700 ? 0.76 : 0.52)), 170, 980);
      const centreY = BAR + room * 0.5;
      const host = stage.parentElement ?? stage; // the page root, so the rest of the page can hang things beside the character
      host.style.setProperty('--cx', `${s.width / 2}px`);
      host.style.setProperty('--cy', `${centreY}px`);
      host.style.setProperty('--tall', `${tall}px`);
      return { w: s.width, h: s.height, frame: { cx: 0.5, cy: centreY / s.height, h: tall / s.height } };
    };
    let size = { w: 0, h: 0 };
    const layout = () => {
      const f = frame();
      // a change of canvas size is immediate; a change in the room below it eases
      if (f.w !== size.w || f.h !== size.h) scene?.resize(f.w, f.h, f.frame);
      else scene?.setFrame(f.frame);
      size = { w: f.w, h: f.h };
    };
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    if (below.current) ro.observe(below.current);
    layout();

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./avatar/AvatarScene')
      .then(({ AvatarScene }) => {
        if (dead) return;
        scene = new AvatarScene(canvas, {
          avatarUrl,
          smokeUrl,
          wallUrl,
          lettersUrl,
          reducedMotion,
          onReady: () => !dead && setState('ready'),
          onError: () => !dead && setState('flat'),
        });
        sceneRef.current = scene;
        if (import.meta.env.DEV) (window as unknown as { __izzad?: AvatarScene }).__izzad = scene; // handle for poking at the scene from the console
        size = { w: 0, h: 0 };
        layout();
      })
      .catch(() => !dead && setState('flat'));

    const move = (e: PointerEvent) => {
      const s = stage.getBoundingClientRect();
      scene?.setPointer(e.clientX - s.left, e.clientY - s.top);
    };
    window.addEventListener('pointermove', move, { passive: true });

    return () => {
      dead = true;
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [below]);

  // ---- pointer: drag the avatar, poke it, or paint the wall
  const drag = useRef<{ x: number; moved: number } | null>(null);
  const local = (e: React.PointerEvent) => {
    const s = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - s.left, y: e.clientY - s.top };
  };

  return (
    <div
      className={cx('iz-stage', `is-${state}`, over === 'avatar' && 'over-avatar')}
      ref={stageRef}
      role="img"
      aria-label="Izzad, the avatar, mid-air in a burst of smoke in front of the Izzad lettering"
      onPointerMove={(e) => {
        const scene = sceneRef.current;
        if (!scene) return;
        const d = drag.current;
        if (d) {
          const dx = e.clientX - d.x;
          d.x = e.clientX;
          d.moved += Math.abs(dx);
          scene.dragBy(dx);
          return;
        }
        const p = local(e);
        const next = scene.hitTest(p.x, p.y) ? 'avatar' : 'wall';
        if (next !== over) setOver(next);
      }}
      onPointerDown={(e) => {
        const scene = sceneRef.current;
        if (!scene || e.button !== 0) return;
        const p = local(e);
        if (scene.hitTest(p.x, p.y)) {
          drag.current = { x: e.clientX, moved: 0 };
          scene.dragStart();
          e.currentTarget.setPointerCapture(e.pointerId);
        } else if (scene.sprayAt(p.x, p.y, PAINTS[paint.current % PAINTS.length])) {
          paint.current++;
          handlers.current.onSpray();
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        sceneRef.current?.dragEnd();
        if (d.moved < 6) handlers.current.onPoke();
      }}
      onPointerCancel={() => {
        drag.current = null;
        sceneRef.current?.dragEnd();
      }}
    >
      {state !== 'ready' && (
        <div className="iz-flat" aria-hidden="true">
          <img className="iz-flat-letters" src={lettersUrl} alt="" draggable={false} />
          <img className="iz-flat-figure" src={posterUrl} alt="" draggable={false} />
        </div>
      )}
      <canvas className="iz-canvas" ref={canvasRef} />
    </div>
  );
});
