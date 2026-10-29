import { Languages } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { LANGUAGES, currentLang, onLangChange, setLang, t, type Lang } from '../lib/i18n';

/** The language menu in the header. The choice is remembered on this device. */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const lang = useSyncExternalStore(onLangChange, currentLang);
  return (
    <label className="relative inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-sm text-ink hover:bg-surface">
      <Languages className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="sr-only">{t('Language')}</span>
      <select
        aria-label={t('Language')}
        className={`cursor-pointer appearance-none bg-transparent pr-1 font-medium outline-none ${compact ? 'max-w-[4.5rem]' : ''}`}
        value={lang}
        onChange={(e) => void setLang(e.target.value as Lang)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
