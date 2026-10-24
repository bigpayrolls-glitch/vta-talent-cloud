import { PORTAL_LABEL, ROLE_LABEL, ROLE_PORTAL, type Portal } from '@vta/shared';
import { ChevronDown, LogOut, Menu, Repeat, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { PORTAL_PATH, useAuth } from '../lib/auth';
import { Wordmark } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (max 5). Others live in the menu. */
  bottom?: boolean;
  end?: boolean;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function UserMenu({ portal }: { portal: Portal }) {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  if (!me) return null;
  const rolesHere = me.roles.filter((r) => ROLE_PORTAL[r.role] === portal);
  const primary = rolesHere[0];
  const others = me.portals.filter((p) => p !== portal);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-surface"
      >
        <span className="grid size-9 place-items-center rounded-full bg-ink text-[13px] font-semibold text-white" aria-hidden>
          {initials(me.name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{me.name}</span>
          <span className="block text-xs text-muted">{primary ? ROLE_LABEL[primary.role] : ''}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <div className="border-b border-line px-4 py-3">
            <p className="font-semibold">{me.name}</p>
            <p className="truncate text-sm text-muted">{me.email ?? me.phone}</p>
            <ul className="mt-2 space-y-0.5 text-[13px] text-muted">
              {me.roles.map((r) => (
                <li key={r.id}>
                  {ROLE_LABEL[r.role]}
                  {r.organisationName ? `, ${r.organisationName}` : ''}
                  {r.centreName ? `, ${r.centreName}` : ''}
                </li>
              ))}
            </ul>
          </div>
          {others.length > 0 && (
            <div className="border-b border-line py-1">
              {others.map((p) => (
                <Link key={p} role="menuitem" to={PORTAL_PATH[p]} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface">
                  <Repeat className="size-4 text-muted" aria-hidden />
                  Switch to {PORTAL_LABEL[p]}
                </Link>
              ))}
            </div>
          )}
          <button role="menuitem" type="button" onClick={signOut} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm hover:bg-surface">
            <LogOut className="size-4 text-muted" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${
    isActive ? 'bg-brand-tint text-brand' : 'text-ink hover:bg-surface'
  }`;

export function PortalLayout({ portal, nav, children }: { portal: Portal; nav: NavItem[]; children?: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  // A one-item bar or menu adds nothing, so both appear only when there is somewhere else to go.
  const bottom = nav.filter((n) => n.bottom).slice(0, 5);
  const showNav = nav.length > 1;

  return (
    <div className="min-h-dvh bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
        {showNav && <button type="button" className="rounded-lg p-2 hover:bg-surface lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>}
        <Link to={PORTAL_PATH[portal]} className="lg:w-[216px]" aria-label={`VTA Talent Cloud, ${PORTAL_LABEL[portal]} home`}>
          <Wordmark compact />
        </Link>
        <span className="hidden text-sm font-medium text-muted md:block">{PORTAL_LABEL[portal]}</span>
        <div className="ml-auto">
          <UserMenu portal={portal} />
        </div>
      </header>

      <div className="flex">
        <nav aria-label={PORTAL_LABEL[portal]} className={`sticky top-16 hidden ${showNav ? '' : 'lg:!hidden'} h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-line px-3 py-5 lg:block`}>
          <ul className="space-y-1">
            {nav.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={navClass}>
                  <n.icon className="size-[18px]" aria-hidden />
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className={`min-w-0 flex-1 px-4 ${showNav ? 'pb-28' : 'pb-12'} pt-6 sm:px-6 lg:px-8 lg:pb-12`}>
          <div className="mx-auto max-w-6xl">{children ?? <Outlet />}</div>
        </main>
      </div>

      {/* Mobile bottom navigation, as in the PWA designs */}
      {showNav && bottom.length > 1 && (
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}>
            {bottom.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-muted'}`}
                >
                  <n.icon className="size-5" aria-hidden />
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Mobile drawer with the full menu */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 w-72 bg-white p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <Wordmark compact />
              <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-2 hover:bg-surface" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <ul className="space-y-1">
              {nav.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.end} className={navClass}>
                    <n.icon className="size-[18px]" aria-hidden />
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
