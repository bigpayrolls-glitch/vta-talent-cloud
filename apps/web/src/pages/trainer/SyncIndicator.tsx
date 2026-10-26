import { AlertTriangle, CheckCircle2, Clock, RefreshCw, WifiOff } from 'lucide-react';
import { Link } from 'react-router';
import { useOffline } from '../../offline/useOffline';

/** Header status for trainers: always an icon and words, never colour alone. Opens Sync status. */
export function SyncIndicator() {
  const off = useOffline();
  if (!off.ready) return null;
  const problems = off.conflicts.length + off.rejected.length;
  const waiting = off.pending.length;
  let icon = <CheckCircle2 className="size-4 text-success" aria-hidden />;
  let text = 'Synced';
  let tone = 'text-ink';
  if (!off.online) {
    icon = <WifiOff className="size-4" aria-hidden />;
    text = waiting ? `Offline, ${waiting} waiting` : 'Offline';
  } else if (problems) {
    icon = <AlertTriangle className="size-4" aria-hidden />;
    text = 'Sync problem';
    tone = 'text-brand';
  } else if (off.syncing) {
    icon = <RefreshCw className="size-4 animate-spin" aria-hidden />;
    text = 'Syncing';
  } else if (waiting) {
    icon = <Clock className="size-4 text-warning" aria-hidden />;
    text = `${waiting} waiting`;
  }
  return (
    <Link to="/partner/sync" className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-[13px] font-medium hover:bg-surface ${tone}`} aria-label={`Sync status: ${text}`}>
      {icon}
      {/* Very narrow phones show the icon only; the link's label still says it in words. */}
      <span className="max-[379px]:sr-only">{text}</span>
    </Link>
  );
}
