import { RefreshCw } from 'lucide-react';
import { useRouteError } from 'react-router';
import { t } from '../lib/i18n';
import { Wordmark } from './ui';

/**
 * Shown instead of a blank error page when a screen fails to draw. The usual cause is a phone or browser still
 * holding an older copy of the site: "Reload" clears that copy and loads the latest.
 */
export function RouteError() {
  const error = useRouteError();
  const reload = async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await caches?.keys()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* nothing to clear */
    }
    window.location.reload();
  };
  console.error(error);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Wordmark tagline />
      <h1 className="text-xl font-bold">{t('Something went wrong on this page')}</h1>
      <p className="text-muted">{t('Reload to get the latest version of AutoTalent Grid. If it happens again, tell AutoTalent Grid what you were doing.')}</p>
      <button type="button" className="btn-primary h-11" onClick={() => void reload()}>
        <RefreshCw className="size-4" aria-hidden />
        {t('Reload')}
      </button>
      <a href="/" className="text-sm font-semibold text-brand underline">
        {t('Go to the home page')}
      </a>
    </main>
  );
}
