import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../lib/i18n';

/**
 * Registers the service worker and offers new versions (PWA version/update handling).
 * Reloading is safe: attendance waiting to sync is kept in the phone's storage, not in the page.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version every hour while the app is open.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), 60 * 60_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg lg:bottom-6">
      <RefreshCw className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t('A new version of AutoTalent Grid is ready.')}</span>
      <button type="button" className="rounded-lg px-2 py-1 font-semibold text-white/80 hover:text-white" onClick={() => setNeedRefresh(false)}>
        {t('Later')}
      </button>
      <button type="button" className="rounded-lg bg-white px-3 py-1 font-semibold text-ink" onClick={() => void updateServiceWorker(true)}>
        {t('Reload')}
      </button>
    </div>
  );
}
