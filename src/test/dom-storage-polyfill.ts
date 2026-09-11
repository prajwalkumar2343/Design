type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function createMapBackedStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key(index: number): string | null {
      if (index < 0 || index >= data.size) return null;
      return Array.from(data.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      data.set(String(key), String(value));
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    clear(): void {
      data.clear();
    },
  };
}

/**
 * Node ≥25 exposes a global `localStorage` even without
 * `--experimental-webstorage`; without `--localstorage-file` it is an inert
 * object with no methods. Vitest's jsdom environment skips installing the
 * window's own storage when a global already exists, so every persistence
 * test breaks on Node 25 while passing on Node 22. Install a working shim
 * whenever the ambient storage is unusable — browsers are unaffected.
 */
for (const name of ["localStorage", "sessionStorage"] as const) {
  const ambient = (globalThis as Record<string, unknown>)[name] as StorageLike | undefined;
  if (typeof ambient?.setItem !== "function") {
    Object.defineProperty(globalThis, name, {
      value: createMapBackedStorage(),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}
