import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Select } from '../../components/form';
import { EmptyState, ErrorNote, formatDate, PageHeader, Pagination, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useListParams } from '../../lib/useListParams';
import { ResultChip } from './AssessmentsTab';

interface QueueItem {
  id: string;
  status: string;
  totalScore: number;
  maxScore: number;
  outcome: 'pass' | 'fail' | null;
  submittedAt: string | null;
  submittedByName: string | null;
  ownSubmission: boolean;
  candidate: { name: string; code: string };
  batch: { id: string; name: string };
  courseTitle: string;
}

/** AD-06: results waiting for an authorised reviewer, oldest first. */
export function ReviewQueuePage() {
  const { values, page, set, setPage } = useListParams(['status'] as const);
  const status = values.status || 'submitted';
  const q = useQuery({
    queryKey: ['review-queue', status, page],
    queryFn: () => api.get<{ items: QueueItem[]; page: number; pageSize: number; total: number }>(`/admin/assessments${qs({ status, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <PageHeader
        title="Assessment review"
        description="Results submitted by trainers. Approve them, return them for correction, or reject them. Nobody can review a result they submitted."
      />
      <div className="mb-4 sm:w-60">
        <Select
          id="rq-status"
          label="Status"
          value={status}
          onChange={(v) => set('status', v === 'submitted' ? '' : v)}
          options={[
            { value: 'submitted', label: 'Awaiting review' },
            { value: 'returned', label: 'Returned for correction' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title={status === 'submitted' ? 'Nothing waiting for review' : 'No results here'} body={status === 'submitted' ? 'Results appear here when trainers submit them.' : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/admin/batches/${r.batch.id}?tab=assessments`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface/60">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{r.candidate.name} <span className="font-normal text-muted">{r.candidate.code}</span></span>
                      <span className="block text-sm text-muted">
                        {r.courseTitle}, {r.batch.name}. {r.totalScore} of {r.maxScore} marks. Submitted {formatDate(r.submittedAt)} by {r.submittedByName}
                        {r.ownSubmission ? ' (you)' : ''}
                      </span>
                    </span>
                    <ResultChip status={r.status} outcome={r.outcome} />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
