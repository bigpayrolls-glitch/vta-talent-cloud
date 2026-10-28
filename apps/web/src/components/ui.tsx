import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { MARK_DARK, MARK_RED, MARK_VIEWBOX } from './logo-paths';

/** The "Road A" symbol on its own (app icons, small spaces). Decorative unless given a label. */
export function LogoMark({ className = 'h-7 w-auto', label, inverse = false }: { className?: string; label?: string; inverse?: boolean }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path fill={inverse ? '#FFFFFF' : '#202124'} fillRule="evenodd" d={MARK_DARK} />
      <path fill="#E31B23" fillRule="evenodd" d={MARK_RED} />
    </svg>
  );
}

/**
 * AutoTalent Grid logo: the symbol and the name, with "Talent" in red (brand artwork of 26 Oct 2026).
 * `tight`: on narrow phones only the symbol shows, leaving room in a busy header.
 */
export function Wordmark({
  compact = false,
  tight = false,
  inverse = false,
  tagline = false,
  large = false,
}: {
  compact?: boolean;
  tight?: boolean;
  inverse?: boolean;
  /** The full lockup from the brand artwork: symbol, name with ™, and "Train. Connect. Employ." beneath the name. */
  tagline?: boolean;
  large?: boolean;
}) {
  const narrowHide = tight ? 'max-[479px]:hidden' : '';
  if (tagline) {
    return (
      <span className="inline-flex items-center gap-2.5 select-none" role="img" aria-label="AutoTalent Grid. Train. Connect. Employ.">
        <LogoMark className={large ? 'h-16 w-auto' : 'h-11 w-auto'} inverse={inverse} />
        <span className="flex flex-col items-center" aria-hidden>
          <span className={`whitespace-nowrap font-black leading-none tracking-[-0.02em] ${large ? 'text-[36px]' : 'text-[24px]'} ${inverse ? 'text-white' : 'text-ink'}`}>
            Auto<span className={inverse ? 'text-[#FF4D55]' : 'text-[#D7141C]'}>Talent</span> Grid
            <sup className={`ml-0.5 align-super font-semibold ${large ? 'text-[11px]' : 'text-[8px]'}`}>™</sup>
          </span>
          <span className={`mt-1 whitespace-nowrap font-medium ${large ? 'text-[15px] tracking-[0.18em]' : 'text-[10.5px] tracking-[0.16em]'} ${inverse ? 'text-white/85' : 'text-ink/85'}`}>
            Train. Connect. Employ.
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 select-none" role="img" aria-label="AutoTalent Grid">
      <LogoMark className={compact ? 'h-7 w-auto' : 'h-9 w-auto'} inverse={inverse} />
      <span className={`whitespace-nowrap font-extrabold tracking-tight ${compact ? 'text-[19px]' : 'text-[23px]'} ${inverse ? 'text-white' : 'text-ink'} ${narrowHide}`} aria-hidden>
        Auto<span className={inverse ? 'text-[#FF4D55]' : 'text-[#D7141C]'}>Talent</span> Grid
      </span>
    </span>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
      {error && (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-tint text-success',
  verified: 'bg-success-tint text-success',
  invited: 'bg-info-tint text-info',
  pending: 'bg-warning-tint text-warning',
  more_info_needed: 'bg-warning-tint text-warning',
  suspended: 'bg-brand-tint text-brand',
  rejected: 'bg-brand-tint text-brand',
  deactivated: 'bg-surface text-muted',
  inactive: 'bg-surface text-muted',
  needs_correction: 'bg-warning-tint text-warning',
  planned: 'bg-info-tint text-info',
  completed: 'bg-surface text-ink',
  cancelled: 'bg-surface text-muted',
  enrolled: 'bg-success-tint text-success',
  withdrawn: 'bg-surface text-muted',
  not_completed: 'bg-brand-tint text-brand',
  not_scanned: 'bg-surface text-muted',
  revoked: 'bg-brand-tint text-brand',
  replaced: 'bg-surface text-muted',
  draft: 'bg-surface text-ink',
  submitted: 'bg-warning-tint text-warning',
  changes_requested: 'bg-brand-tint text-brand',
  upcoming: 'bg-info-tint text-info',
  ongoing: 'bg-success-tint text-success',
  pending_review: 'bg-warning-tint text-warning',
  published: 'bg-success-tint text-success',
  paused: 'bg-surface text-muted',
  closed: 'bg-surface text-muted',
  applied: 'bg-info-tint text-info',
  shortlisted: 'bg-info-tint text-info',
  interview: 'bg-warning-tint text-warning',
  offer: 'bg-warning-tint text-warning',
  joined: 'bg-success-tint text-success',
  not_joined: 'bg-surface text-muted',
  unverified: 'bg-warning-tint text-warning',
  flagged: 'bg-brand-tint text-brand',
};

const STATUS_LABEL: Record<string, string> = {
  more_info_needed: 'More info needed',
  needs_correction: 'Needs correction',
  not_completed: 'Not completed',
  not_scanned: 'Not scanned',
  pending_review: 'Waiting for review',
  not_joined: 'Did not join',
  submitted: 'Submitted for review',
  changes_requested: 'Changes requested',
};

/** Status chip: colour is always paired with the word (never colour alone, §16). */
export function StatusBadge({ status, label: override }: { status: string; label?: string }) {
  const label = override ?? STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? 'bg-surface text-muted'}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/** Accessible modal built on the native <dialog> element (focus trap and Escape for free). */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-32px)] ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[calc(100dvh-32px)] rounded-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40`}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="px-5 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-brand/30 bg-brand-tint px-4 py-3 text-sm text-brand">
      {message}
    </div>
  );
}

/** +919876543210 → +91 98765 43210 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime && { hour: 'numeric', minute: '2-digit' }),
  }).format(new Date(iso));
}
