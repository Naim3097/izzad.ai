import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as db from './db';
import type { ToolId } from './tools';
import type { Asset, Bin, Note, Origin, Project } from './types';

const uid = () => crypto.randomUUID();

// ---- blob URLs -------------------------------------------------------------
// File bytes are only pulled out of IndexedDB when something needs to show them.

const urlCache = new Map<string, string>();
const urlPending = new Map<string, Promise<string | null>>();

function loadUrl(blobId: string): Promise<string | null> {
  const cached = urlCache.get(blobId);
  if (cached) return Promise.resolve(cached);
  let p = urlPending.get(blobId);
  if (!p) {
    p = db.getOne<Blob>('blobs', blobId).then((blob) => {
      urlPending.delete(blobId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(blobId, url);
      return url;
    });
    urlPending.set(blobId, p);
  }
  return p;
}

function dropUrl(blobId: string) {
  const url = urlCache.get(blobId);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(blobId);
}

export function useBlobUrl(blobId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(blobId ? (urlCache.get(blobId) ?? null) : null);
  useEffect(() => {
    if (!blobId) {
      setUrl(null);
      return;
    }
    let live = true;
    setUrl(urlCache.get(blobId) ?? null);
    loadUrl(blobId).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [blobId]);
  return url;
}

export async function downloadAsset(asset: Asset) {
  const blob = await db.getOne<Blob>('blobs', asset.blobId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = asset.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---- store -----------------------------------------------------------------

export interface NewFileOpts {
  tool: ToolId;
  bin: Bin;
  origin: Origin;
  projectId: string;
  parentId?: string;
  createdAt?: number;
  tags?: string[];
}

interface Store {
  ready: boolean;
  assets: Asset[];
  notes: Note[];
  projects: Project[];
  addFiles: (files: File[], opts: NewFileOpts) => Promise<Asset[]>;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  sendTo: (id: string, tool: ToolId) => void;
  addNote: (n: Omit<Note, 'id' | 'createdAt'> & { createdAt?: number }) => void;
  removeNote: (id: string) => void;
  addProject: (p: Omit<Project, 'id' | 'createdAt'>) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => void;
  wipe: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const assetsRef = useRef<Asset[]>([]);
  assetsRef.current = assets;

  useEffect(() => {
    Promise.all([db.getAll<Asset>('assets'), db.getAll<Note>('notes'), db.getAll<Project>('projects')]).then(
      ([a, n, p]) => {
        setAssets(a.sort((x, y) => y.createdAt - x.createdAt));
        setNotes(n.sort((x, y) => y.createdAt - x.createdAt));
        setProjects(p.sort((x, y) => x.createdAt - y.createdAt));
        setReady(true);
      },
    );
    // Ask the browser not to evict the library under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const addFiles = useCallback(async (files: File[], opts: NewFileOpts) => {
    const created: Asset[] = [];
    let t = opts.createdAt ?? Date.now();
    for (const file of files) {
      const blobId = uid();
      await db.put('blobs', file, blobId);
      const asset: Asset = {
        id: uid(),
        blobId,
        name: file.name,
        mime: file.type,
        size: file.size,
        tool: opts.tool,
        bin: opts.bin,
        origin: opts.origin,
        projectId: opts.projectId,
        tags: opts.tags ?? [],
        note: '',
        createdAt: t++,
        parentId: opts.parentId,
      };
      await db.put('assets', asset);
      created.push(asset);
    }
    setAssets((prev) => [...created.slice().reverse(), ...prev]);
    return created;
  }, []);

  const updateAsset = useCallback((id: string, patch: Partial<Asset>) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        db.put('assets', next);
        return next;
      }),
    );
  }, []);

  const removeAsset = useCallback((id: string) => {
    const target = assetsRef.current.find((a) => a.id === id);
    if (!target) return;
    db.del('assets', id);
    const shared = assetsRef.current.some((a) => a.id !== id && a.blobId === target.blobId);
    if (!shared) {
      db.del('blobs', target.blobId);
      dropUrl(target.blobId);
    }
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const sendTo = useCallback((id: string, tool: ToolId) => {
    const src = assetsRef.current.find((a) => a.id === id);
    if (!src || src.tool === tool) return;
    // A handoff is a new record pointing at the same bytes, so nothing is duplicated on disk.
    const copy: Asset = { ...src, id: uid(), tool, bin: 'in', parentId: src.id, createdAt: Date.now(), seq: undefined };
    db.put('assets', copy);
    setAssets((prev) => [copy, ...prev]);
  }, []);

  const addNote = useCallback((n: Omit<Note, 'id' | 'createdAt'> & { createdAt?: number }) => {
    const note: Note = { ...n, id: uid(), createdAt: n.createdAt ?? Date.now() };
    db.put('notes', note);
    setNotes((prev) => [note, ...prev]);
  }, []);

  const removeNote = useCallback((id: string) => {
    db.del('notes', id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addProject = useCallback((p: Omit<Project, 'id' | 'createdAt'>) => {
    const project: Project = { ...p, id: uid(), createdAt: Date.now() };
    db.put('projects', project);
    setProjects((prev) => [...prev, project]);
    return project;
  }, []);

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        db.put('projects', next);
        return next;
      }),
    );
  }, []);

  const removeProject = useCallback((id: string) => {
    db.del('projects', id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    // Assets and notes survive; they just become unassigned.
    setAssets((prev) =>
      prev.map((a) => {
        if (a.projectId !== id) return a;
        const next = { ...a, projectId: '' };
        db.put('assets', next);
        return next;
      }),
    );
    setNotes((prev) =>
      prev.map((n) => {
        if (n.projectId !== id) return n;
        const next = { ...n, projectId: '' };
        db.put('notes', next);
        return next;
      }),
    );
  }, []);

  const wipe = useCallback(async () => {
    await Promise.all([db.clear('assets'), db.clear('blobs'), db.clear('notes'), db.clear('projects')]);
    for (const id of Array.from(urlCache.keys())) dropUrl(id);
    setAssets([]);
    setNotes([]);
    setProjects([]);
  }, []);

  const value = useMemo<Store>(
    () => ({
      ready,
      assets,
      notes,
      projects,
      addFiles,
      updateAsset,
      removeAsset,
      sendTo,
      addNote,
      removeNote,
      addProject,
      updateProject,
      removeProject,
      wipe,
    }),
    [ready, assets, notes, projects, addFiles, updateAsset, removeAsset, sendTo, addNote, removeNote, addProject, updateProject, removeProject, wipe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** Bytes actually on disk: shared blobs are counted once. */
export function storageBytes(assets: Asset[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const a of assets) {
    if (seen.has(a.blobId)) continue;
    seen.add(a.blobId);
    total += a.size;
  }
  return total;
}
