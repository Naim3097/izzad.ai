// The tool registry. Everything the workspace knows about a tool lives here:
// add, remove or reorder entries and the dock, pipeline and workspaces follow.

import capcutLogo from './assets/logos/capcut.svg';
import claudeCodeLogo from './assets/logos/claudecode.svg';
import higgsfieldLogo from './assets/logos/higgsfield.png';
import illustratorLogo from './assets/logos/illustrator.svg';
import magnificLogo from './assets/logos/magnific.svg';
import openaiLogo from './assets/logos/openai.svg';
import photoshopLogo from './assets/logos/photoshop.svg';

export type ToolId =
  | 'chatgpt'
  | 'claude'
  | 'higgsfield'
  | 'magnific'
  | 'photoshop'
  | 'illustrator'
  | 'capcut';

export type Stage = 'Think' | 'Generate' | 'Craft' | 'Cut';

// Which centre stage the workspace swaps to when the tool is opened.
export type Layout = 'prompt' | 'generate' | 'compare' | 'canvas' | 'timeline';

/** The tool's own mark, set on a tile the way an app icon sits in a dock. */
export interface ToolLogo {
  src: string;
  bg: string; // tile colour; matches the artwork's own background for full-bleed icons
  inset: number; // 0 = artwork fills the tile, otherwise padding as a fraction of the tile
  invert?: boolean; // single-colour glyph supplied in black, shown in white
}

export interface Tool {
  id: ToolId;
  name: string;
  short: string; // dock caption
  logo: ToolLogo;
  stage: Stage;
  layout: Layout;
  kind: 'Web app' | 'Desktop app' | 'Terminal';
  url?: string; // web tools open here; desktop tools are launched locally
  maker: 'human' | 'ai'; // who produces this tool's output by default
  role: string;
  you: string; // what the designer decides here
  machine: string; // what the tool does
  inLabel: string;
  outLabel: string;
  formats: string[];
}

export const STAGES: Stage[] = ['Think', 'Generate', 'Craft', 'Cut'];

export const TOOLS: Tool[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    short: 'ChatGPT',
    logo: { src: openaiLogo, bg: '#FFFFFF', inset: 0.19 },
    stage: 'Think',
    layout: 'prompt',
    kind: 'Web app',
    url: 'https://chatgpt.com/',
    maker: 'ai',
    role: 'Briefs, concepts, copy and prompt drafting',
    you: 'The brief, the angle, and what gets thrown away.',
    machine: 'Drafts options faster than you can type them.',
    inLabel: 'References',
    outLabel: 'Concepts',
    formats: ['TXT', 'MD', 'PDF', 'PNG', 'JPG'],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    short: 'Claude',
    logo: { src: claudeCodeLogo, bg: '#1F1E1D', inset: 0.2 },
    stage: 'Think',
    layout: 'prompt',
    kind: 'Terminal',
    url: 'https://claude.ai/code',
    maker: 'ai',
    role: 'Automation, batch scripts and builds',
    you: 'What is worth automating, and the spec.',
    machine: 'Writes the code and runs it.',
    inLabel: 'Specs',
    outLabel: 'Builds',
    formats: ['MD', 'JSON', 'JS', 'PY', 'ZIP'],
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    short: 'Higgsfield',
    logo: { src: higgsfieldLogo, bg: '#D1FE17', inset: 0 },
    stage: 'Generate',
    layout: 'generate',
    kind: 'Web app',
    url: 'https://higgsfield.ai/',
    maker: 'ai',
    role: 'Image and video generation',
    you: 'Direction, references, and the pick.',
    machine: 'Renders the variations.',
    inLabel: 'References',
    outLabel: 'Generations',
    formats: ['PNG', 'JPG', 'WEBP', 'MP4'],
  },
  {
    id: 'magnific',
    name: 'Magnific',
    short: 'Magnific',
    logo: { src: magnificLogo, bg: '#000000', inset: 0 },
    stage: 'Generate',
    layout: 'compare',
    kind: 'Web app',
    url: 'https://www.magnific.com/',
    maker: 'ai',
    role: 'Upscale, enhance and stock',
    you: 'How far to push, and what must stay true.',
    machine: 'Adds resolution and detail.',
    inLabel: 'Originals',
    outLabel: 'Upscales',
    formats: ['PNG', 'JPG', 'WEBP'],
  },
  {
    id: 'photoshop',
    name: 'Photoshop',
    short: 'Photoshop',
    logo: { src: photoshopLogo, bg: '#001E36', inset: 0 },
    stage: 'Craft',
    layout: 'canvas',
    kind: 'Desktop app',
    maker: 'human',
    role: 'Retouch, composite and grade',
    you: 'Every pixel that ships.',
    machine: 'Generative fill and selections.',
    inLabel: 'Sources',
    outLabel: 'Exports',
    formats: ['PSD', 'PSB', 'PNG', 'JPG', 'TIFF'],
  },
  {
    id: 'illustrator',
    name: 'Illustrator',
    short: 'Illustrator',
    logo: { src: illustratorLogo, bg: '#330000', inset: 0 },
    stage: 'Craft',
    layout: 'canvas',
    kind: 'Desktop app',
    maker: 'human',
    role: 'Vector, logo, layout and print',
    you: 'Form, type, and the system.',
    machine: 'Trace, recolor and mockups.',
    inLabel: 'Sources',
    outLabel: 'Exports',
    formats: ['AI', 'SVG', 'EPS', 'PDF', 'PNG'],
  },
  {
    id: 'capcut',
    name: 'CapCut',
    short: 'CapCut',
    logo: { src: capcutLogo, bg: '#000000', inset: 0.21, invert: true },
    stage: 'Cut',
    layout: 'timeline',
    kind: 'Desktop app',
    url: 'https://www.capcut.com/',
    maker: 'human',
    role: 'Edit, caption, sound and export',
    you: 'Rhythm, story, and the final cut.',
    machine: 'Captions, cleanup and templates.',
    inLabel: 'Clips',
    outLabel: 'Renders',
    formats: ['MP4', 'MOV', 'PNG', 'MP3', 'WAV'],
  },
];

export const toolById = (id: ToolId): Tool => TOOLS.find((t) => t.id === id)!;

/** The tool that usually comes next in the flow, if any. */
export const nextTool = (id: ToolId): Tool | undefined => TOOLS[TOOLS.findIndex((t) => t.id === id) + 1];
