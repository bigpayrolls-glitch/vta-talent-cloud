import { useEffect, useRef, useState } from 'react';

/**
 * EE-12: keeps an unsaved form on this device so a dropped connection or a closed tab does not lose it.
 * Only what the person typed into that form is kept, under their own user id, and it is removed when the form
 * is saved, discarded, or the person signs out.
 */
const PREFIX = 'vta-draft:';

export function useDraft<T extends object>(key: string, initial: T): { value: T; setValue: (v: T) => void; restored: boolean; clear: () => void } {
  const storageKey = PREFIX + key;
  const [restored] = useState(() => read(storageKey) !== null);
  const [value, setValueState] = useState<T>(() => ({ ...initial, ...(read(storageKey) ?? {}) }));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the form still works, just without a saved draft */
    }
  }, [storageKey, value]);
  return {
    value,
    setValue: setValueState,
    restored,
    clear: () => {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* nothing to clear */
      }
    },
  };
}

function read(key: string): object | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as object) : null;
  } catch {
    return null;
  }
}

/** Removes every saved form draft on this device (sign-out). */
export function clearAllDrafts(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* blocked storage: nothing was saved */
  }
}
