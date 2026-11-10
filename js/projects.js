// Project library kept in browser storage, plus export/import as JSON files.
const LIB = 'taillight-projects-v1';

export const STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'test', label: 'Test' },
  { id: 'official', label: 'Official' },
];

export function readLib() {
  try {
    const l = JSON.parse(localStorage.getItem(LIB));
    if (l && typeof l.projects === 'object') return l;
  } catch {}
  return { projects: {}, current: null };
}
export function writeLib(lib) {
  try { localStorage.setItem(LIB, JSON.stringify(lib)); return true; } catch { return false; }
}
export const newProjectId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function exportPayload(p) {
  return { app: 'taillight-studio', format: 1, name: p.name, status: p.status, exported: new Date().toISOString(), project: p.data };
}

// accepts an exported file, or a bare project object
export function parseImport(text) {
  const j = JSON.parse(text);
  const isWrapped = j && j.app === 'taillight-studio';
  const data = isWrapped ? j.project : j;
  if (!data || typeof data !== 'object' || !data.matrix) throw new Error("That file isn't a Taillight Studio project.");
  const status = STATUSES.some((s) => s.id === j.status) ? j.status : 'draft';
  return { name: String((isWrapped && j.name) || 'Imported project').slice(0, 60), status, data };
}
