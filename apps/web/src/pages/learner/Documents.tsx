import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, DOCUMENT_VISIBILITY_LABEL, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type DocumentVisibility } from '@vta/shared';
import { Download, Eye, EyeOff, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError, qs, uploadFile } from '../../lib/api';
import { t } from '../../lib/i18n';
import { fmtDate } from './attendance';
import type { LearnerDocument } from './types';

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** EE-03: evidence the learner keeps on their profile. Each file shows who may see it and whether VTA has verified it. */
export function DocumentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['me', 'documents'], queryFn: () => api.get<{ items: LearnerDocument[]; max: number }>('/me/documents') });
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<LearnerDocument | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'documents'] });

  const open = async (d: LearnerDocument) => {
    try {
      const { url } = await api.get<{ url: string }>(`/me/documents/${d.id}/link`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('Could not open the document'));
    }
  };
  const toggle = async (d: LearnerDocument) => {
    const visibility: DocumentVisibility = d.visibility === 'private' ? 'employers' : 'private';
    await api.patch(`/me/documents/${d.id}`, { visibility });
    await refresh();
    toast('success', visibility === 'private' ? t('{title}: only you and AutoTalent Grid', { title: d.title }) : t('{title}: employers you share your profile with can see it', { title: d.title }));
  };

  return (
    <>
      <PageHeader
        title={t('My documents')}
        description={t('Certificates, experience letters and other evidence of your skills.')}
        actions={
          <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
            <Upload className="size-4" aria-hidden />
            {t('Upload')}
          </button>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <EmptyState title={t('No documents yet')} body={t('Upload certificates or experience letters. You choose whether employers may see each one.')} />
      ) : (
        <ul className="card divide-y divide-line">
          {q.data!.items.map((d) => (
            <li key={d.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-[13px] text-muted">
                    {d.uploadedBySelf
                      ? `${t(DOCUMENT_KIND_LABEL[d.kind as keyof typeof DOCUMENT_KIND_LABEL])}, ${size(d.sizeBytes)}, ${fmtDate(d.createdAt)}`
                      : t('{kind}, {size}, {date}, added by AutoTalent Grid', { kind: t(DOCUMENT_KIND_LABEL[d.kind as keyof typeof DOCUMENT_KIND_LABEL]), size: size(d.sizeBytes), date: fmtDate(d.createdAt) })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusBadge status={d.verificationStatus} label={d.verificationStatus === 'verified' ? t('Verified by AutoTalent Grid') : d.verificationStatus === 'rejected' ? t('Not accepted') : t('Not checked yet')} />
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-medium">
                      {d.visibility === 'private' ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                      {t(DOCUMENT_VISIBILITY_LABEL[d.visibility])}
                    </span>
                  </div>
                  {d.reviewReason && <p className="mt-2 text-[13px] text-brand">{t("AutoTalent Grid's note: {reason}", { reason: d.reviewReason })}</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 pl-8">
                <button type="button" className="btn-secondary btn-sm" onClick={() => void open(d)}>
                  <Download className="size-4" aria-hidden />
                  {t('Open')}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => void toggle(d)}>
                  {d.visibility === 'private' ? t('Let employers see it') : t('Make private')}
                </button>
                {d.canDelete && (
                  <button type="button" className="btn-quiet btn-sm" onClick={() => setRemoving(d)} aria-label={t('Remove {title}', { title: d.title })}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('Remove')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-muted">
        {t('Employers can see a document only if you let them and you share your profile. Each download link works for 5 minutes. Files are not virus-scanned yet.')}
      </p>

      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={refresh} />}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('Remove document?')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRemoving(null)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await api.del(`/me/documents/${removing!.id}`);
                setRemoving(null);
                await refresh();
                toast('success', t('Document removed'));
              }}
            >
              {t('Remove')}
            </button>
          </>
        }
      >
        <p>{t('{title} will be removed from your profile.', { title: removing?.title ?? '' })}</p>
      </Modal>
    </>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>('certificate');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<DocumentVisibility>('private');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!file) e.file = t('Choose a file');
    else if (file.size > UPLOAD_MAX_BYTES) e.file = t('The file is larger than 10 MB');
    if (title.trim().length < 2) e.title = t('Give the document a title');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await uploadFile(`/me/documents${qs({ kind, title: title.trim(), fileName: file!.name, visibility })}`, file!);
      await onDone();
      toast('success', t('Document uploaded. AutoTalent Grid will check it.'));
      onClose();
    } catch (err) {
      const x = err as { fields?: Record<string, string>; message: string };
      setErrors({ ...(x.fields ?? {}), _: x.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Upload document')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? t('Uploading…') : t('Upload')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ && <ErrorNote message={errors._} />}
        <Field label={t('File')} htmlFor="doc-file" error={errors.file} hint={t('{types}, up to 10 MB. You can take a photo.', { types: Object.values(UPLOAD_TYPES).join(', ') })}>
          <input
            id="doc-file"
            type="file"
            accept={Object.keys(UPLOAD_TYPES).join(',')}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-tint file:px-4 file:py-2.5 file:font-semibold file:text-brand"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </Field>
        <Field label={t('Type')} htmlFor="doc-kind">
          <select id="doc-kind" className="field-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(DOCUMENT_KIND_LABEL[k])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Title')} htmlFor="doc-title" error={errors.title}>
          <input id="doc-title" className="field-input" placeholder={t('For example, ITI certificate')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="field-label">{t('Who can see it')}</legend>
          {(['private', 'employers'] as const).map((vis) => (
            <label key={vis} className="mt-1.5 flex items-center gap-3 text-sm">
              <input type="radio" name="doc-vis" className="size-4 accent-[var(--color-brand)]" checked={visibility === vis} onChange={() => setVisibility(vis)} />
              {t(DOCUMENT_VISIBILITY_LABEL[vis])}
            </label>
          ))}
        </fieldset>
        <p className="text-[13px] text-muted">{t('Do not upload Aadhaar or other ID documents.')}</p>
      </div>
    </Modal>
  );
}
