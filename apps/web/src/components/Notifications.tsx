import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto, Portal } from '@vta/shared';
import { Bell, CheckCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { PORTAL_PATH } from '../lib/auth';
import { t } from '../lib/i18n';
import { EmptyState, ErrorNote, PageHeader, Spinner } from './ui';

/** SH-07: the header bell. Checks for new notifications every minute while the page is open and visible. */
export function NotificationBell({ portal }: { portal: Portal }) {
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const n = q.data?.unread ?? 0;
  return (
    <Link
      to={`${PORTAL_PATH[portal]}/notifications`}
      className="relative grid size-10 place-items-center rounded-full text-ink hover:bg-surface"
      aria-label={n ? t('Notifications, {n} unread', { n }) : t('Notifications')}
    >
      <Bell className="size-5" aria-hidden />
      {n > 0 && (
        <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[11px] font-bold leading-none text-white" aria-hidden>
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 7 * 86_400) return t('{n} d ago', { n: Math.floor(s / 86_400) });
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

interface NotificationPage {
  items: NotificationDto[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) => api.get<NotificationPage>(`/notifications?page=${pageParam}&pageSize=20`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  const open = async (n: NotificationDto) => {
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
      refresh();
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('Notifications')}
        description={unread ? t('{n} unread', { n: unread }) : t('You are up to date.')}
        actions={
          unread > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await api.post('/notifications/read-all');
                refresh();
              }}
            >
              <CheckCheck className="size-4" aria-hidden />
              {t('Mark all as read')}
            </button>
          )
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title={t('No notifications yet')} body={t('Updates about your work on the platform appear here.')} />
        </div>
      ) : (
        <>
          <ul className="card divide-y divide-line overflow-hidden">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void open(n)} className={`flex w-full gap-3 px-4 py-4 text-left hover:bg-surface/70 sm:px-5 ${n.readAt ? '' : 'bg-brand-tint/40'}`}>
                  <span className={`mt-2 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block ${n.readAt ? 'font-medium' : 'font-semibold'}`}>
                      {n.title}
                      {!n.readAt && <span className="sr-only"> {t('(unread)')}</span>}
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-4 text-center">
              <button type="button" className="btn-secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? t('Loading…') : t('Show older')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
