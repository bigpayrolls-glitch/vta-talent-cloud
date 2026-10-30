import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/*
 * "Showroom" dashboard pieces (design option D): a workshop photo hero, number cards that float over
 * its bottom edge, white panels and a dark "next steps" panel. Every portal home uses these, so all
 * dashboards look the same.
 */

export function HeroBanner({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  image = '/home-hero.webp',
  floating = true,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  image?: string;
  /** Leave room at the bottom for a StatRow that overlaps the photo. */
  floating?: boolean;
}) {
  return (
    <section
      className="font-display relative flex overflow-hidden rounded-[28px] bg-[#16181c] bg-cover bg-[center_35%] text-white"
      style={{ backgroundImage: `url(${image})` }}
    >
      <div
        className={`flex min-h-[260px] flex-1 flex-col justify-end gap-5 px-6 pt-8 sm:min-h-[300px] sm:px-10 sm:pt-9 ${floating ? 'pb-20 sm:pb-24' : 'pb-8 sm:pb-9'}`}
        style={{ background: 'linear-gradient(90deg, rgba(12,13,16,0.94) 0%, rgba(12,13,16,0.8) 50%, rgba(12,13,16,0.3) 100%)' }}
      >
        <div>
          {eyebrow && <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#FF8A90] sm:text-[13px]">{eyebrow}</p>}
          <h1 className="mt-2 max-w-[560px] text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">{title}</h1>
          {subtitle && <p className="mt-2.5 max-w-[520px] text-[15px] text-[#D5D8DE]">{subtitle}</p>}
          {children}
          {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
        </div>
      </div>
    </section>
  );
}

/** Red button on the hero photo. */
export const heroPrimary =
  'inline-flex h-12 items-center gap-2 rounded-[14px] bg-[#C8101A] px-5 text-[15px] font-bold text-white transition-colors hover:bg-[#a90d16]';
/** See-through button on the hero photo. */
export const heroSecondary =
  'inline-flex h-12 items-center gap-2 rounded-[14px] border border-white/30 bg-white/15 px-5 text-[15px] font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25';

/** Number cards. Put it straight after a HeroBanner: it slides up over the photo's bottom edge. */
export function StatRow({ children, cols = 4, overlap = true, label = 'Key numbers' }: { children: ReactNode; cols?: 3 | 4 | 6; overlap?: boolean; label?: string }) {
  const grid = cols === 6 ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4';
  return (
    <section aria-label={label} className={`font-display relative grid gap-2.5 sm:gap-4 ${grid} ${overlap ? '-mt-14 px-3 sm:-mt-16 sm:px-6' : 'mt-4'}`}>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  note,
  to,
  icon: Icon,
  highlight = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  to?: string;
  icon?: LucideIcon;
  highlight?: boolean;
}) {
  const shell = highlight
    ? 'bg-[#C8101A] text-white shadow-[0_20px_40px_-24px_rgba(200,16,26,0.75)]'
    : 'bg-white text-[#121418] shadow-[0_20px_40px_-24px_rgba(18,20,24,0.45)]';
  const soft = highlight ? 'text-white/85' : 'text-[#5B616E]';
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-[13px] font-semibold ${soft}`}>{label}</p>
        {Icon && <Icon className={`hidden size-[18px] shrink-0 sm:block ${highlight ? 'text-white/80' : 'text-[#C8101A]'}`} aria-hidden />}
      </div>
      <p className="mt-2 text-[28px] font-extrabold leading-none tracking-[-0.02em] sm:text-[32px]">{value}</p>
      {note && <p className={`mt-1.5 text-[12px] leading-snug ${soft}`}>{note}</p>}
    </>
  );
  const cls = `block min-w-0 rounded-[20px] px-3.5 py-4 sm:px-5 sm:py-5 ${shell}`;
  return to ? (
    <Link to={to} className={`${cls} transition-transform hover:-translate-y-0.5`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** White rounded panel with an optional heading and link. */
export function Panel({
  title,
  link,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  link?: { to: string; label: ReactNode };
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={title && id ? id : undefined} className={`min-w-0 rounded-[22px] bg-white p-5 sm:p-6 ${className}`}>
      {(title || link) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && (
            <h2 id={id} className="font-display text-[18px] font-extrabold tracking-[-0.01em]">
              {title}
            </h2>
          )}
          {link && (
            <Link to={link.to} className="inline-flex items-center gap-1 text-[13px] font-bold text-[#C8101A] hover:underline">
              {link.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Dark panel with numbered red badges. Items without a link are shown as plain text. */
export function NextSteps({ title, items, empty, id = 'next-steps', footer }: { title: ReactNode; items: { n?: number; label: ReactNode; to?: string }[]; empty?: ReactNode; id?: string; footer?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="font-display min-w-0 rounded-[22px] bg-[#121418] p-5 text-white sm:p-6">
      <h2 id={id} className="text-[18px] font-extrabold tracking-[-0.01em]">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#B9BDC6]">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {items.map((it, i) => {
            const inner = (
              <>
                <span className={`grid h-8 min-w-8 shrink-0 place-items-center rounded-[10px] px-1.5 text-[13px] font-extrabold ${i === 0 ? 'bg-[#C8101A]' : 'bg-[#3A3E47]'}`}>
                  {it.n ?? i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[14px]">{it.label}</span>
                {it.to && <ArrowRight className="size-4 shrink-0 text-[#FF8A90]" aria-hidden />}
              </>
            );
            return (
              <li key={i}>
                {it.to ? (
                  <Link to={it.to} className="flex items-center gap-3 rounded-[14px] bg-[#1E2127] p-3.5 text-white transition-colors hover:bg-[#272B33]">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-[14px] bg-[#1E2127] p-3.5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {footer && <div className="mt-4 text-[12px] text-[#B9BDC6]">{footer}</div>}
    </section>
  );
}

/** A small grey chip with a number on top, as used on the job cards. */
export function MiniStat({ n, label }: { n: ReactNode; label: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 rounded-[10px] bg-[#F4F5F7] px-1 py-2 text-center text-[12px] text-[#5B616E]">
      <b className="block text-[18px] leading-tight text-[#121418]">{n}</b>
      <span className="block break-words text-[11px] leading-tight">{label}</span>
    </span>
  );
}
