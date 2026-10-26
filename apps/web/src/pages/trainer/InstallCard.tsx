import { Download, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome and Edge on Android fire this once per page load, so it is captured as early as possible.
let deferred: InstallPromptEvent | null = null;
const waiters = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    waiters.forEach((w) => w());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    waiters.forEach((w) => w());
  });
}

const DISMISS_KEY = 'vta-install-dismissed';
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Invites trainers to add the app to their home screen. Android/desktop Chrome and Edge get an Install button;
 * iPhone and iPad (Safari has no install prompt) get the steps. Hidden once installed or dismissed.
 */
export function InstallCard() {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const w = () => rerender((n) => n + 1);
    waiters.add(w);
    return () => {
      waiters.delete(w);
    };
  }, []);

  if (dismissed || isStandalone()) return null;
  const ios = isIos();
  if (!deferred && !ios) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode: just hide for now */
    }
  };

  return (
    <section className="card mt-6 flex items-start gap-4 px-5 py-4" aria-label="Install the app">
      <img src="/icons/atg-icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Add AutoTalent Grid to your home screen</p>
        {ios ? (
          <p className="mt-0.5 text-sm text-muted">
            In Safari, tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share, then <strong>Add to Home Screen</strong>. It opens like an app and takes attendance offline.
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-sm text-muted">Opens like an app, starts faster and takes attendance without a connection.</p>
            <button
              type="button"
              className="btn-primary btn-sm mt-3"
              onClick={async () => {
                const e = deferred;
                if (!e) return;
                await e.prompt();
                await e.userChoice.catch(() => undefined);
                deferred = null;
                rerender((n) => n + 1);
              }}
            >
              <Download className="size-4" aria-hidden />
              Install app
            </button>
          </>
        )}
      </div>
      <button type="button" onClick={dismiss} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Not now">
        <X className="size-4" />
      </button>
    </section>
  );
}
