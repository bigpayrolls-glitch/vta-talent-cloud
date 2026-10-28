import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Download, FileUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { ErrorNote, PageHeader } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface ImportRow {
  row: number;
  name: string;
  phone: string;
  status: 'ready' | 'possible_duplicate' | 'error';
  messages: string[];
}
interface ImportResult {
  committed: boolean;
  imported: number;
  summary: { total: number; ready: number; possibleDuplicates: number; errors: number };
  rows: ImportRow[];
}

const TEMPLATE = [
  'name,phone,date_of_birth,city,state,skill_areas,experience_months,email,education,languages',
  'Sunil Hegde,9876543210,1998-02-14,Mangaluru,Karnataka,2W;EV,24,,ITI Motor Mechanic,Kannada;English',
].join('\n');

const ROW_STATUS: Record<ImportRow['status'], { cls: string; label: string }> = {
  ready: { cls: 'bg-success-tint text-success', label: 'Ready' },
  possible_duplicate: { cls: 'bg-warning-tint text-warning', label: 'Possible duplicate' },
  error: { cls: 'bg-brand-tint text-brand', label: 'Will be skipped' },
};

/** T-03: two-step CSV import. Check first, then import the valid rows. */
export function ImportCandidatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (commit: boolean, text = csv) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<ImportResult>('/admin/candidates/import', { csv: text, commit });
      setResult(r);
      if (commit) {
        await qc.invalidateQueries({ queryKey: ['candidates'] });
        await qc.invalidateQueries({ queryKey: ['dashboard'] });
        toast('success', `${r.imported} ${r.imported === 1 ? 'candidate' : 'candidates'} imported`);
      }
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? [e.message, ...Object.values(e.fields)].join(' ') : 'The file could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'vta-candidates-template.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  const importable = result ? result.summary.ready + result.summary.possibleDuplicates : 0;
  // Large files: list rows needing attention first, and at most 500 rows in all, so the page stays quick.
  const order = { error: 0, possible_duplicate: 1, ready: 2 } as const;
  const shown = result ? [...result.rows].sort((a, b) => order[a.status] - order[b.status] || (b.messages.length ? 1 : 0) - (a.messages.length ? 1 : 0) || a.row - b.row).slice(0, 500) : [];

  return (
    <div>
      <Link to="/admin/candidates" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All candidates
      </Link>
      <PageHeader title="Import candidates" description="Upload a CSV file. Every row is checked before anything is saved." />

      <ol className="mb-6 grid gap-3 md:grid-cols-3">
        <li className="card p-4">
          <p className="text-sm font-semibold">1. Prepare the file</p>
          <p className="mt-1 text-sm text-muted">Columns name and phone are required. Add date_of_birth and city if you have them; anyone without them adds them at first sign-in. Separate several skills or languages with semicolons.</p>
          <button className="btn-secondary btn-sm mt-3" onClick={downloadTemplate}>
            <Download className="size-4" aria-hidden />
            Download template
          </button>
        </li>
        <li className="card p-4">
          <p className="text-sm font-semibold">2. Check it</p>
          <p className="mt-1 text-sm text-muted">Up to 10,000 rows. Rows with problems are listed and will be skipped. Nothing is saved yet.</p>
        </li>
        <li className="card p-4">
          <p className="text-sm font-semibold">3. Import</p>
          <p className="mt-1 text-sm text-muted">Valid rows become invited candidates, pending verification. Possible duplicates are flagged for review.</p>
        </li>
      </ol>

      <div className="card p-5">
        <label htmlFor="csv-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-brand hover:bg-brand-tint/40">
          <FileUp className="size-7 text-brand" aria-hidden />
          <span className="font-semibold">{fileName || 'Choose a CSV file'}</span>
          <span className="text-sm text-muted">Exported from Excel or Google Sheets as CSV (UTF-8)</span>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 3_500_000) {
                setError('The file is too large (over 3.5 MB). Split it into two files.');
                return;
              }
              const text = await f.text();
              setFileName(f.name);
              setCsv(text);
              setResult(null);
              void run(false, text);
            }}
          />
        </label>
        {busy && <p className="mt-4 text-sm text-muted" role="status">Checking…</p>}
        {error && <div className="mt-4"><ErrorNote message={error} /></div>}
      </div>

      {result && (
        <section className="mt-6">
          {result.committed ? (
            <div className="card flex items-center gap-3 px-5 py-4" role="status">
              <CheckCircle2 className="size-6 text-success" aria-hidden />
              <div>
                <p className="font-semibold">{result.imported} imported</p>
                <p className="text-sm text-muted">{result.summary.errors} {result.summary.errors === 1 ? 'row was' : 'rows were'} skipped. New candidates are pending verification.</p>
              </div>
              <Link to="/admin/candidates?verificationStatus=pending" className="btn-primary ml-auto">Review candidates</Link>
            </div>
          ) : (
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
              <p><span className="text-xl font-bold">{result.summary.ready}</span> <span className="text-sm text-muted">ready</span></p>
              <p><span className="text-xl font-bold">{result.summary.possibleDuplicates}</span> <span className="text-sm text-muted">possible duplicates</span></p>
              <p><span className="text-xl font-bold">{result.summary.errors}</span> <span className="text-sm text-muted">with problems</span></p>
              <button className="btn-primary ml-auto" disabled={busy || importable === 0} onClick={() => void run(true)}>
                {importable === 0 ? 'Nothing to import' : `Import ${importable} ${importable === 1 ? 'candidate' : 'candidates'}`}
              </button>
            </div>
          )}

          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-surface/60 text-[13px] text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Row</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Mobile</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.row} className="align-top">
                    <td className="px-4 py-3 tabular-nums text-muted">{r.row}</td>
                    <td className="px-4 py-3 font-medium">{r.name || '—'}</td>
                    <td className="px-4 py-3">{r.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROW_STATUS[r.status].cls}`}>
                        <span className="size-1.5 rounded-full bg-current" aria-hidden />
                        {ROW_STATUS[r.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px]">{r.messages.join('. ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length > shown.length && (
              <p className="border-t border-line px-4 py-3 text-sm text-muted">
                Showing rows with problems or notes first, then the rest: {shown.length} of {result.rows.length}. All {importable} importable rows are imported.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
