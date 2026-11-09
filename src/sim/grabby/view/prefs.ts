// Small per-viewer preferences in localStorage. Storage can be missing or throw (private mode,
// blocked site data), so every access is wrapped and falls back to the default.
export const ADVANCED_KEY = 'grabby-aliens:advanced';

export function readFlag(storage: Storage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(storage: Storage | undefined, key: string, on: boolean) {
  try {
    storage?.setItem(key, on ? '1' : '0');
  } catch {
    // not remembered; harmless
  }
}
