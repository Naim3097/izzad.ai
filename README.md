# Izzad

Two pages, one static site.

**The front page** (`index.html`) is the funnel. Izzad, a 3D avatar on a painted wall, makes one offer: drop your website link and get two ad posters, free. The visitor pastes a link or types a request, watches the run go through the tools in order, and gets two pieces. A third asks for an email.

**The workspace** (`workspace.html`) is the designer's side: seven tools, and the files that move between them, on a single screen.

| Stage | Tools |
|---|---|
| Think | ChatGPT, Claude Code |
| Generate | Higgsfield, Magnific |
| Craft | Photoshop, Illustrator |
| Cut | CapCut |

In the workspace each tool has an **In** bin (what you bring to it) and an **Out** bin (what you made there). Drag a file onto another tool in the dock to hand it off; the link back to its source is kept. Every file is tagged Hand, AI + Hand or AI, and Home shows how much of what ships passed through the designer's hands.

## The engine is not connected yet

The front page runs on a stand-in. It walks the four stages on a timer and hangs two empty boards; it does not read the visitor's site, generate anything, or send their email anywhere. The page says so while it runs ("Preview run", "Waits on the engine").

The real engine plugs in at one place: `src/front/engine.ts`. Implement the `Engine` interface (`run` streams stage and asset events, `lead` receives the email) and export it as `engine`. Nothing else on the page changes. Keep API keys on a server the engine calls, never in this bundle.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173 for the front page, or http://localhost:5173/workspace.html for the workspace.

The front page remembers in the browser that the two free pieces were used. Add `?reset` to the address to clear that while testing.

## Build and deploy

```bash
npm run build
```

The output in `dist/` is a static site with relative asset paths, so it can be served from a domain root or a sub-path. Vercel, Netlify and Cloudflare Pages detect Vite automatically (build command `npm run build`, output directory `dist`).

Link previews need an image at an absolute address. `workspace.html` points `og:image` at `og-image.png`; change it to the full URL on the live domain. `index.html` has no preview image yet.

## How it stores data

The workspace keeps everything in the visitor's own browser (IndexedDB). There is no server, no account and no upload: files stay on the machine they were added on, and are not shared between browsers or devices.

## Where things live

- `src/front/` — the front page. `Funnel.tsx` is the page and its copy, `Stage.tsx` and `avatar/AvatarScene.ts` are the 3D scene, `Belt.tsx` is the row of tools, `engine.ts` is the seam for the real engine, `front.css` is all of its styling.
- `src/front/assets/` — the avatar and smoke models, the wall and the lettering.
- `pipeline/avatar/` — the Blender scripts that build those models (rig, pose, spray can, smoke relief).
- `src/tools.ts` — the tool registry: names, order, stages, URLs, logos. Both pages read it. Edit this to add or reorder tools.
- `src/styles.css` — the workspace's design tokens (colour, type, radii, motion) and styling.
- `src/stages.tsx` — the centre area of each tool workspace (prompt log, generation grid, before/after, canvas, timeline).
- `src/store.tsx`, `src/db.ts` — workspace state and IndexedDB storage.
- `src/assets/brand/`, `public/` — the Izzad logo, favicon and home-screen icons.

## Trademarks

The Photoshop, Illustrator, CapCut, ChatGPT, Claude, Higgsfield and Magnific names and logos belong to their respective owners. They are shown only to identify the tools Izzad works with. Izzad is not affiliated with or endorsed by any of them.
