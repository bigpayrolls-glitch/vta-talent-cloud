import { useQueryClient } from '@tanstack/react-query';
import { changePhoneSchema } from '@vta/shared';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, formatPhone, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';

/**
 * Phase 11: VTA changes the mobile number a learner or trainer signs in with, after checking who they are.
 * Shown to Operations and Super Admins, for accounts that sign in by phone.
 */
export function ChangePhoneButton({ userId, name, phone, className = 'btn-quiet btn-sm' }: { userId: string; name: string; phone: string | null; className?: string }) {
  const { can, me } = useAuth();
  const [open, setOpen] = useState(false);
  if (!phone || !can('user.suspend') || me?.id === userId) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Change mobile number
      </button>
      {open && <ChangePhoneModal userId={userId} name={name} phone={phone} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePhoneModal({ userId, name, phone, onClose }: { userId: string; name: string; phone: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(changePhoneSchema);
  const [v, setV] = useState({ phone: '', reason: '' });
  return (
    <Modal
      open
      onClose={onClose}
      title="Change mobile number"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={f.submitting}
            onClick={() =>
              void f.submit(v, async (data) => {
                await api.post(`/admin/users/${userId}/phone`, data);
                await qc.invalidateQueries();
                toast('success', `${name} now signs in with ${formatPhone(data.phone)}`);
                onClose();
              })
            }
          >
            {f.submitting ? 'Saving…' : 'Change number'}
          </button>
        </>
      }
    >
      <p className="text-sm">
        {name} signs in with <span className="font-semibold">{formatPhone(phone)}</span>. Change it only after checking who they are, for example with an ID card. They are signed out
        everywhere and sign in again with a code sent to the new number.
      </p>
      <div className="mt-4 space-y-4">
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="New mobile number" htmlFor="new-phone" error={f.errors.phone}>
          <div className="flex">
            <span className="grid place-items-center rounded-l-lg border border-r-0 border-line bg-surface px-3 text-[15px] text-muted">+91</span>
            <input id="new-phone" type="tel" inputMode="numeric" className="field-input rounded-l-none" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} aria-invalid={!!f.errors.phone} />
          </div>
        </Field>
        <Field label="How you checked who they are" htmlFor="phone-reason" error={f.errors.reason} hint="Kept in the audit log.">
          <textarea id="phone-reason" className="field-input min-h-20" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} aria-invalid={!!f.errors.reason} />
        </Field>
      </div>
    </Modal>
  );
}
