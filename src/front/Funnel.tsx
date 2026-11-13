// Izzad's front door. One offer, said by the avatar: drop a link, get two pieces free.
// Idle, it is a prompt box under a persona. Sent, it is a run you can watch: the belt lights up tool
// by tool and the avatar sprays the pieces onto their boards. Delivered, it asks for the one thing
// it wants: a way to keep going with you.
//
// The avatar is not decoration here. Everything the visitor does to the page, it answers: it watches
// the caret as they type, takes the link out of the box when they send it, looks at the tool that is
// working, and its spray is what reveals each piece.

import { ArrowUp, Link2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import brandLogo from '../assets/brand/izzad-logo.webp';
import type { Stage as RunStage } from '../tools';
import { Belt, cx, type Tell } from './Belt';
import { FREE_PIECES, SIZES, engine, type Asset, type AssetKind, type Brief } from './engine';
import { Stage, type StageHandle } from './Stage';

const KINDS: { id: AssetKind; chip: string; pair: string }[] = [
  { id: 'poster', chip: 'Ad posters', pair: 'two ad posters' },
  { id: 'social', chip: 'Social posts', pair: 'two social posts' },
  { id: 'kit', chip: 'Brand kit', pair: 'two brand kit boards' },
  { id: 'logo', chip: 'Logos', pair: 'two logo marks' },
];

type Phase = 'idle' | 'working' | 'delivered' | 'joined';

// The free pair is remembered in this browser so the page greets a returning visitor honestly.
// This is a courtesy, not a limit: the engine has to enforce the allowance on its side.
const SPENT_KEY = 'izzad.free';
if (new URLSearchParams(window.location.search).has('reset')) {
  try {
    localStorage.removeItem(SPENT_KEY);
  } catch {
    /* storage unavailable */
  }
}
function spent(): boolean {
  try {
    return localStorage.getItem(SPENT_KEY) === 'used';
  } catch {
    return false;
  }
}
function spend() {
  try {
    localStorage.setItem(SPENT_KEY, 'used');
  } catch {
    /* storage unavailable */
  }
}

const STILL = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A link, or a brief in the visitor's own words. Anything else gets a nudge. */
function readBrief(raw: string, kind: AssetKind): { ok: true; brief: Brief; label: string } | { ok: false; say: string } {
  const text = raw.trim();
  if (!text) return { ok: false, say: 'Paste your website link first. *yourbrand.com* is enough.' };
  const link = text.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i);
  if (link) {
    const host = link[1].toLowerCase();
    return { ok: true, brief: { kind, url: `https://${host}${link[2] ?? ''}` }, label: host.replace(/^www\./, '') };
  }
  if (text.split(/\s+/).length >= 4) return { ok: true, brief: { kind, prompt: text }, label: text };
  return { ok: false, say: 'That does not read as a link. Try *yourbrand.com*, or tell me what you need in a sentence.' };
}

function useMedia(query: string): boolean {
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

/** A line of speech. The part worth catching is wrapped in *asterisks*. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split('*').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function Frame({ asset, index, kind, hang }: { asset: Asset | undefined; index: number; kind: AssetKind; hang: (el: HTMLElement | null) => void }) {
  const size = asset ?? { ...SIZES[kind], label: `${SIZES[kind].name} ${index + 1}` };
  const ratio = { aspectRatio: `${size.width} / ${size.height}`, '--r': size.width / size.height } as CSSProperties;
  // The board itself stays put. Its face is what the avatar's spray opens out.
  if (asset?.url) {
    return (
      <a ref={hang} className="iz-frame is-ready" style={ratio} href={asset.url} download aria-label={`${asset.label}. Download.`}>
        <span className="iz-frame-face">
          <img src={asset.url} alt={asset.label} draggable={false} />
        </span>
      </a>
    );
  }
  return (
    <div ref={hang} className={cx('iz-frame', asset ? 'is-waiting' : 'is-queued')} style={ratio}>
      <span className="iz-frame-face" key={asset ? 'in' : 'queued'}>
        <strong>{size.label}</strong>
        <span>
          {size.width}×{size.height}
        </span>
        {asset && <em>Waits on the engine</em>}
      </span>
    </div>
  );
}

/** What was sent, leaving the box and arcing up into the avatar's hand. */
function Flyer({ text, from, to, onArrive }: { text: string; from: DOMRect; to: { x: number; y: number }; onArrive: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  const x0 = from.left + 18;
  const y0 = from.top + from.height / 2;
  useEffect(() => {
    const dx = to.x - x0;
    const dy = to.y - y0;
    const flight = ref.current!.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.62 - 46}px) scale(0.86)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.28)`, opacity: 0.15 },
      ],
      { duration: 540, easing: 'cubic-bezier(0.3, 0, 0.7, 1)', fill: 'forwards' },
    );
    flight.onfinish = () => arrive.current();
    return () => flight.cancel();
  }, [to.x, to.y, x0, y0]);
  return (
    <span ref={ref} className="iz-flyer" style={{ left: x0, top: y0 }} aria-hidden="true">
      {text}
    </span>
  );
}

export function Funnel() {
  const stage = useRef<StageHandle>(null);
  const deck = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLFormElement>(null); // whichever box is showing: the link, or the email
  const run = useRef<AbortController | null>(null);
  const boards = useRef<(HTMLElement | null)[]>([]);
  const arrived = useRef(0); // pieces the engine has handed over
  const [phase, setPhase] = useState<Phase>(() => (spent() ? 'delivered' : 'idle'));
  const [kind, setKind] = useState<AssetKind>('poster');
  const [draft, setDraft] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [asked, setAsked] = useState('');
  const [step, setStep] = useState<{ stage: RunStage; note: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [revealed, setRevealed] = useState(0); // pieces the avatar's spray has reached
  const [finished, setFinished] = useState(false);
  const [flyer, setFlyer] = useState<{ text: string; from: DOMRect; to: { x: number; y: number }; go: () => void } | null>(null);
  const [nudged, setNudged] = useState(false);
  const [email, setEmail] = useState('');
  const [remark, setRemark] = useState<string | null>(null);
  const remarkTimer = useRef(0);
  const typing = useRef(false);
  const lastPointer = useRef(0);
  const pasted = useRef(false);
  const acked = useRef('');
  const ruler = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => () => run.current?.abort(), []);
  useEffect(() => {
    const moved = () => (lastPointer.current = performance.now());
    window.addEventListener('pointermove', moved, { passive: true });
    return () => window.removeEventListener('pointermove', moved);
  }, []);

  const pair = KINDS.find((k) => k.id === kind)!.pair;
  const parsed = readBrief(draft, kind);

  // ---- what the avatar says ------------------------------------------------------
  const headline =
    phase === 'idle'
      ? `Drop me your website link. I’ll make you *${pair}*, free.`
      : phase === 'working'
        ? (step?.note ?? 'Got it. On it.')
        : phase === 'joined'
          ? 'You’re in. I’ll be in touch.'
          : assets.length === 0
            ? 'You’ve had your *two free*. Want the full run?'
            : engine.preview
              ? 'That’s the run. The frames fill in once the engine is connected.'
              : `Your *${pair}*. Yours to keep.`;

  const aside =
    remark ??
    (phase === 'idle'
      ? 'No brief, no sign-up. I read your site, match your brand and build them while you watch.'
      : phase === 'working'
        ? engine.preview
          ? 'Preview run. The engine is not connected in this build, so nothing is read or rendered yet.'
          : 'Watch the tools below. That is the run.'
        : phase === 'joined'
          ? engine.preview
            ? 'Preview build: your email was not sent anywhere.'
            : `Keep an eye on ${email}.`
          : 'Social sizes, brand kit, logo, UGC video. Leave your email and I’ll open the full run.');

  /** Something said in passing: a hover, a nudge. It gives way to the standing line again. */
  const flash = useCallback((text: string, ms = 4200) => {
    window.clearTimeout(remarkTimer.current);
    setRemark(text);
    stage.current?.nod();
    remarkTimer.current = window.setTimeout(() => setRemark(null), ms);
  }, []);

  const tell = useCallback<Tell>((text, el) => {
    window.clearTimeout(remarkTimer.current);
    setRemark(text);
    if (text === null) return stage.current?.attend(null);
    if (el) {
      const r = el.getBoundingClientRect();
      stage.current?.attend({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  }, []);

  // ---- the avatar and the box ----------------------------------------------------

  /** Its eyes stay on the caret: where the visitor is writing, not just the box in general. */
  const watchCaret = (el: HTMLInputElement) => {
    typing.current = true;
    const r = el.getBoundingClientRect();
    const g = (ruler.current ??= document.createElement('canvas').getContext('2d'));
    let x = r.left + 8;
    if (g) {
      const cs = getComputedStyle(el);
      g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      x = r.left + Math.min(r.width - 8, g.measureText(el.value.slice(0, el.selectionStart ?? el.value.length)).width);
    }
    stage.current?.attend({ x, y: r.top + r.height / 2 });
  };
  const leaveBox = () => {
    typing.current = false;
    stage.current?.attend(null);
  };

  // A link it can use has landed in the box. Pasted, it says so at once; typed, once the typing pauses.
  const ready = parsed.ok;
  const linked = parsed.ok && parsed.brief.url ? parsed.label : '';
  useEffect(() => {
    if (phase !== 'idle' || !linked) {
      if (!linked) acked.current = '';
      return;
    }
    if (linked === acked.current) return;
    const ack = () => {
      acked.current = linked;
      flash(`Got it: *${linked}*. Hit enter and I’ll get to work.`, 7000);
      stage.current?.perform('shake'); // can's ready
    };
    if (pasted.current) {
      pasted.current = false;
      return ack();
    }
    const id = window.setTimeout(ack, 750);
    return () => window.clearTimeout(id);
  }, [linked, phase, flash]);

  // Left alone, it does not just hang there: it checks the box, rattles the can, looks out at you, tags the wall.
  useEffect(() => {
    if (STILL || phase === 'working' || phase === 'joined') return;
    const beats = ['box', 'shake', 'you', 'box', 'tag', 'you'] as const;
    let n = 0;
    let due = performance.now() + 3800;
    let ease = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      const s = stage.current;
      if (!s || document.hidden || now < due || typing.current || now - lastPointer.current < 2200) return;
      due = now + 4400 + Math.random() * 2600;
      const beat = beats[n++ % beats.length];
      if (beat === 'box' && box.current) {
        const r = box.current.getBoundingClientRect();
        s.attend({ x: r.left + r.width / 2, y: r.top });
        setNudged(true);
        ease = window.setTimeout(() => {
          setNudged(false);
          if (!typing.current) s.attend(null);
        }, 1500);
      } else if (beat === 'shake') s.perform('shake');
      else if (beat === 'you') s.face(1.8);
      else if (beat === 'tag' && phase === 'idle') s.tag();
    }, 400);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(ease);
      setNudged(false);
    };
  }, [phase]);

  // ---- the run ---------------------------------------------------------------------
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (phase !== 'idle') return;
    if (!parsed.ok) return flash(parsed.say);
    const sent = parsed;
    const from = box.current?.querySelector('input')?.getBoundingClientRect();
    window.clearTimeout(remarkTimer.current);
    setBrief(sent.brief);
    setAsked(sent.label);
    setStep(null);
    setAssets([]);
    setRevealed(0);
    setFinished(false);
    setRemark(null);
    arrived.current = 0;
    typing.current = false;
    setPhase('working');

    const go = () => {
      const ctl = new AbortController();
      run.current = ctl;
      engine.run(
        sent.brief,
        (ev) => {
          const s = stage.current;
          if (ev.type === 'stage') {
            setStep({ stage: ev.stage, note: ev.note });
            // it looks down at the tool that is working, and gets the can ready when it is its turn
            const group = document.querySelector(`.iz-belt-stage[data-stage="${ev.stage}"]`);
            if (group) {
              const r = group.getBoundingClientRect();
              s?.attend({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
              window.setTimeout(() => stage.current?.attend(null), 1150);
            }
            if (ev.stage === 'Generate' || ev.stage === 'Cut') s?.perform('shake');
            else s?.nod();
          } else if (ev.type === 'asset') {
            const i = arrived.current++;
            setAssets((a) => [...a, ev.asset]);
            // the piece shows when the avatar's spray reaches its board, not before
            const land = () => setRevealed((n) => Math.max(n, i + 1));
            const board = boards.current[i];
            if (board && s) s.sprayOn(board, land);
            else land();
          } else if (ev.type === 'done') {
            setFinished(true);
          } else {
            setPhase('idle');
            flash(ev.message, 6000);
          }
        },
        ctl.signal,
      );
    };

    // The link leaves the box and goes to the avatar's hand. It catches it, then the run starts.
    const to = STILL ? null : stage.current?.anchor('hand');
    if (from && to) {
      setFlyer({
        text: sent.label,
        from,
        to,
        go: () => {
          setFlyer(null);
          stage.current?.perform('catch');
          window.setTimeout(go, 260);
        },
      });
    } else {
      stage.current?.nod();
      go();
    }
  };

  // Delivered means the engine is done and every piece has been sprayed in.
  useEffect(() => {
    if (phase !== 'working' || !finished || revealed < arrived.current) return;
    const id = window.setTimeout(() => {
      spend();
      setPhase('delivered');
      stage.current?.perform('cheer');
    }, 450);
    return () => window.clearTimeout(id);
  }, [phase, finished, revealed]);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) return flash('That email does not look right.');
    await engine.lead(address, brief);
    setEmail(address);
    setRemark(null);
    typing.current = false;
    setPhase('joined');
    stage.current?.perform('wave');
  };

  const left = phase === 'idle' || phase === 'working' ? FREE_PIECES : 0;
  const threaded = asked !== '' && phase !== 'idle';
  // With room either side of the avatar, the pieces go up on the wall. Without it, they sit in the thread.
  const onWall = useMedia('(min-width: 1100px) and (min-height: 640px)');
  const frames = Array.from({ length: FREE_PIECES }, (_, i) => (
    <Frame key={i} asset={i < revealed ? assets[i] : undefined} index={i} kind={kind} hang={(el) => (boards.current[i] = el)} />
  ));

  return (
    <div className="iz">
      <Stage ref={stage} below={deck} onPoke={() => flash('Easy. The horns are load-bearing.')} onSpray={() => undefined} />

      {threaded && onWall && (
        <section className="iz-wallposts" aria-label="Your pieces">
          {frames}
        </section>
      )}

      <header className="iz-bar">
        <a className="iz-brand" href="./">
          <img src={brandLogo} width={34} height={34} alt="" draggable={false} />
          <span>izzad</span>
        </a>
        <span className={cx('iz-free', left === 0 && 'is-spent')} aria-label={left ? `${left} free pieces left` : 'Free pair used'}>
          {Array.from({ length: FREE_PIECES }, (_, i) => (
            <i key={i} className={cx(i < left && 'is-on')} />
          ))}
          {left ? `${left} free` : 'Free pair used'}
        </span>
      </header>

      <main className="iz-deck" ref={deck}>
        <div className="iz-talk">
          <span className="iz-who" key={`who ${headline}`}>
            Izzad
            <i />
            <i />
            <i />
          </span>
          <h1 className="iz-line" key={`line ${headline}`}>
            <Words text={headline} />
          </h1>
          <p className={cx('iz-aside', remark && 'is-remark')} key={aside}>
            <Words text={aside} />
          </p>
          <p className="iz-sr" role="status">
            {headline.replaceAll('*', '')}
          </p>
        </div>

        <div className={cx('iz-answer', threaded && 'is-open')} aria-hidden={!threaded}>
          <div className="iz-answer-fold">
            {threaded && (
              <section className={cx('iz-thread', onWall && 'is-slim')} aria-label="Your run">
                <header>
                  <p className="iz-you">
                    <span>{asked}</span>
                    <em>{KINDS.find((k) => k.id === kind)!.chip}</em>
                  </p>
                  {engine.preview && <span className="iz-flag">Preview run</span>}
                </header>
                {!onWall && <div className="iz-frames">{frames}</div>}
              </section>
            )}
          </div>
        </div>

        {phase === 'idle' && (
          <>
            <form className={cx('iz-composer', nudged && 'is-nudged')} onSubmit={send} ref={box}>
              <Link2 size={18} aria-hidden="true" />
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  watchCaret(e.currentTarget);
                }}
                onPaste={() => (pasted.current = true)}
                onFocus={(e) => watchCaret(e.currentTarget)}
                onKeyUp={(e) => watchCaret(e.currentTarget)}
                onClick={(e) => watchCaret(e.currentTarget)}
                onBlur={leaveBox}
                placeholder="yourbrand.com"
                aria-label="Your website link, or what you need"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button type="submit" className={cx(ready && 'is-ready')} aria-label={`Make my ${pair}`} disabled={!draft.trim()}>
                <ArrowUp size={18} strokeWidth={2.6} />
              </button>
            </form>
            <div className="iz-asks" role="radiogroup" aria-label="What should I make">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  className={cx('iz-ask', kind === k.id && 'is-on')}
                  onClick={() => {
                    setKind(k.id);
                    stage.current?.nod();
                  }}
                >
                  {k.chip}
                </button>
              ))}
            </div>
          </>
        )}

        {phase === 'delivered' && (
          <form className={cx('iz-composer is-gate', nudged && 'is-nudged')} onSubmit={join} ref={box}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                watchCaret(e.currentTarget);
              }}
              onFocus={(e) => watchCaret(e.currentTarget)}
              onBlur={leaveBox}
              placeholder="you@yourbrand.com"
              aria-label="Your email"
              autoComplete="email"
              enterKeyHint="send"
            />
            <button type="submit" className="is-wide" disabled={!email.trim()}>
              Get the full run
            </button>
          </form>
        )}

        <Belt at={step?.stage ?? null} finished={step !== null && phase !== 'working'} tell={tell} />
      </main>

      {flyer && <Flyer text={flyer.text} from={flyer.from} to={flyer.to} onArrive={flyer.go} />}
    </div>
  );
}
