import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useOffline } from '../../offline/useOffline';
import { AttendanceRecorder } from '../operations/AttendanceRecorder';

/** The trainer's attendance screen. Opens from the Today list and works without a connection. */
export function TakeAttendancePage() {
  const { id = '' } = useParams();
  const off = useOffline();
  const batch = off.batches.find((b) => b.id === id);
  return (
    <>
      <Link to="/partner" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Today
      </Link>
      <header className="mb-5 mt-3">
        <h1 className="text-2xl font-bold tracking-tight">{batch?.name ?? 'Attendance'}</h1>
        {batch && (
          <p className="mt-1 text-muted">
            {batch.courseName}, {batch.centreName}
            {off.online && (
              <>
                {' · '}
                <Link to={`/partner/batches/${batch.id}`} className="font-medium text-brand underline">Batch details</Link>
              </>
            )}
          </p>
        )}
      </header>
      <AttendanceRecorder batchId={id} />
    </>
  );
}
