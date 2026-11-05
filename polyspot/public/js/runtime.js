// Settings from the server, loaded once before the first page renders (see app.js).
import { api } from './api.js';

export const runtime = { info: {} };

export async function loadRuntime() {
  runtime.info = await api.info().catch(() => ({}));
}
