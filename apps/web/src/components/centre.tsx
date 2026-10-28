import { useQueryClient } from '@tanstack/react-query';
import { centreMapLink, partnerCentreSchema } from '@vta/shared';
import { ExternalLink, LocateFixed, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useForm } from '../lib/useForm';
import { useToast } from './toast';
import { ErrorNote, Field, Modal } from './ui';

export interface CentreLocation {
  latitude: number | null;
  longitude: number | null;
  mapUrl: string;
}

/**
 * Where the centre is: the phone's GPS position (the browser asks the person first), or a pasted Google Maps
 * link. Either gives a "View on Google Maps" link; no Google key is needed.
 */
export function LocationPicker({ value, onChange, error }: { value: CentreLocation; onChange: (v: CentreLocation) => void; error?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const link = centreMapLink({ latitude: value.latitude, longitude: value.longitude, mapUrl: value.mapUrl || null });

  const locate = () => {
    setProblem('');
    if (!('geolocation' in navigator)) return setProblem('This device cannot share its location. Paste a Google Maps link instead.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        onChange({ ...value, latitude: Math.round(p.coords.latitude * 1e6) / 1e6, longitude: Math.round(p.coords.longitude * 1e6) / 1e6 });
      },
      (e) => {
        setBusy(false);
        setProblem(
          e.code === e.PERMISSION_DENIED
            ? 'Location permission was not given. Allow location for this site in your browser settings, or paste a Google Maps link.'
            : 'Could not find your location. Try again outdoors, or paste a Google Maps link.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <fieldset className="space-y-3 rounded-xl border border-line px-4 py-3">
      <legend className="px-1 text-sm font-semibold">Location on map</legend>
      <p className="text-xs text-muted">Stand at the centre and use your phone&apos;s location, or paste the centre&apos;s Google Maps link.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={locate} disabled={busy}>
          <LocateFixed className="size-4" aria-hidden />
          {busy ? 'Finding location…' : value.latitude != null ? 'Update my current location' : 'Use my current location'}
        </button>
        {value.latitude != null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-tint px-3 py-1 text-xs">
            <MapPin className="size-3.5 text-success" aria-hidden />
            Pinned {value.latitude.toFixed(5)}, {value.longitude?.toFixed(5)}
            <button type="button" aria-label="Remove the pinned location" className="text-muted hover:text-ink" onClick={() => onChange({ ...value, latitude: null, longitude: null })}>
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <Field label="Google Maps link (optional)" htmlFor="centre-map" error={error}>
        <input id="centre-map" type="url" inputMode="url" className="field-input" placeholder="https://maps.app.goo.gl/…" value={value.mapUrl} onChange={(e) => onChange({ ...value, mapUrl: e.target.value })} />
      </Field>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline">
          View on Google Maps <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </fieldset>
  );
}

/** A training partner adds a centre for its own organisation. Calls onAdded with the new centre's id. */
export function AddCentreModal({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(partnerCentreSchema);
  const [v, setV] = useState({ name: '', city: '', address: '', contactPhone: '' });
  const [loc, setLoc] = useState<CentreLocation>({ latitude: null, longitude: null, mapUrl: '' });
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a new centre"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" form="add-centre-form" disabled={f.submitting}>
            {f.submitting ? 'Adding…' : 'Add centre'}
          </button>
        </>
      }
    >
      <form
        id="add-centre-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const body = { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')), latitude: loc.latitude, longitude: loc.longitude, mapUrl: loc.mapUrl || null };
          void f.submit(body, async (data) => {
            const r = await api.post<{ id: string }>('/partner/centres', data);
            await qc.invalidateQueries({ queryKey: ['centre-options'] });
            await qc.invalidateQueries({ queryKey: ['centres'] });
            toast('success', 'Centre added');
            onAdded(r.id);
          });
        }}
      >
        <p className="text-sm text-muted">The centre is added for your organisation and can be used straight away. AutoTalent Grid is told and may correct it.</p>
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Centre name" htmlFor="ac-name" error={f.errors.name}>
          <input id="ac-name" autoFocus className="field-input" placeholder="For example VOC Bengaluru" value={v.name} onChange={upd('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="ac-city" error={f.errors.city}>
            <input id="ac-city" className="field-input" value={v.city} onChange={upd('city')} />
          </Field>
          <Field label="Contact mobile (optional)" htmlFor="ac-phone" error={f.errors.contactPhone}>
            <input id="ac-phone" type="tel" inputMode="numeric" className="field-input" value={v.contactPhone} onChange={upd('contactPhone')} />
          </Field>
        </div>
        <Field label="Address (optional)" htmlFor="ac-addr" error={f.errors.address}>
          <input id="ac-addr" className="field-input" value={v.address} onChange={upd('address')} />
        </Field>
        <LocationPicker value={loc} onChange={setLoc} error={f.errors.mapUrl} />
      </form>
    </Modal>
  );
}

/** The value of the extra option at the end of a centre list that opens "Add a new centre". */
export const ADD_CENTRE = '__add_centre__';
