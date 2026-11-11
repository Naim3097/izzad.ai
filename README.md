# Izzad

One workspace for a designer's whole pipeline. Seven tools, and the files that move between them, on a single screen.

| Stage | Tools |
|---|---|
| Think | ChatGPT, Claude Code |
| Generate | Higgsfield, Magnific |
| Craft | Photoshop, Illustrator |
| Cut | CapCut |

Each tool has its own workspace with an **In** bin (what you bring to it) and an **Out** bin (what you made there). Drag a file onto another tool in the dock to hand it off; the link back to its source is kept. Every file is tagged Hand, AI + Hand or AI, and Home shows how much of what ships passed through the designer's hands.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Build and deploy

```bash
npm run build
```

The output in `dist/` is a static site with relative asset paths, so it can be served from a domain root or a sub-path. Vercel, Netlify and Cloudflare Pages detect Vite automatically (build command `npm run build`, output directory `dist`).

Before sharing links publicly, change `og:image` in `index.html` to the full URL of `og-image.png` on the live domain; link previews need an absolute address.

## How it stores data

Everything is kept in the visitor's own browser (IndexedDB). There is no server, no account and no upload: files stay on the machine they were added on, and are not shared between browsers or devices.

## Where things live

- `src/tools.ts` — the tool registry: names, order, stages, URLs, logos. Edit this to add or reorder tools.
- `src/styles.css` — the design tokens (colour, type, radii, motion) and all styling.
- `src/stages.tsx` — the centre area of each tool workspace (prompt log, generation grid, before/after, canvas, timeline).
- `src/store.tsx`, `src/db.ts` — state and IndexedDB storage.
- `src/assets/brand/`, `public/` — the Izzad logo, favicon and home-screen icons.

## Trademarks

The Photoshop, Illustrator, CapCut, ChatGPT, Claude, Higgsfield and Magnific names and logos belong to their respective owners. They are shown only to identify the tools this workspace links to. Izzad is not affiliated with or endorsed by any of them.
