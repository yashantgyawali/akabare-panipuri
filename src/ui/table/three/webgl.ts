/** Whether this browser can draw the WebGL table (checked once). */
let ok: boolean | null = null;

export function hasWebGL(): boolean {
  if (ok !== null) return ok;
  try {
    const c = document.createElement('canvas');
    ok = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    ok = false;
  }
  return ok;
}
