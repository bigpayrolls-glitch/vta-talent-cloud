import { Field } from './ui';

/**
 * Accommodation with food for a course (29 Oct 2026): whether it is available, and the charge for the whole
 * course once it is decided. Learners say whether they need it when they enrol.
 */
export function StayFields({
  available,
  fee,
  meals,
  error,
  onChange,
}: {
  available: boolean;
  fee: string;
  meals: number;
  error?: string;
  onChange: (v: { available: boolean; fee: string; meals: number }) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-line px-4 py-3">
      <legend className="px-1 text-sm font-semibold">Accommodation with food</legend>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={available} onChange={(e) => onChange({ available: e.target.checked, fee, meals })} />
        <span>Learners can ask for accommodation (a place to stay) with food during this course</span>
      </label>
      {available && (
        <Field label="Meals included" htmlFor="stay-meals" hint="Shown to learners, for example “Accommodation with 1 meal a day”.">
          <select id="stay-meals" className="field-input sm:max-w-[240px]" value={meals} onChange={(e) => onChange({ available, fee, meals: Number(e.target.value) })}>
            <option value={1}>1 meal a day</option>
            <option value={2}>2 meals a day</option>
            <option value={3}>3 meals a day</option>
          </select>
        </Field>
      )}
      {available && (
        <Field label="Charge for accommodation with food, whole course (₹, optional)" htmlFor="stay-fee" error={error} hint="Leave empty until the price is decided. Learners who ask for it are told the charge will be confirmed.">
          <input id="stay-fee" type="number" min={0} step={1} inputMode="numeric" className="field-input sm:max-w-[240px]" value={fee} onChange={(e) => onChange({ available, fee: e.target.value, meals })} />
        </Field>
      )}
    </fieldset>
  );
}
