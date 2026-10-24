import { useState } from 'react';
import type { z } from 'zod';
import { ApiError } from './api';

/**
 * Small form helper: validates with the shared Zod schema in the browser (same rules as the API),
 * then maps any server field errors back onto the form.
 */
export function useForm<S extends z.ZodType>(schema: S) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(values: unknown, action: (data: z.output<S>) => Promise<void>) {
    setFormError('');
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.') || '_'] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await action(parsed.data);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        if (!Object.keys(e.fields).length || e.code !== 'VALIDATION_FAILED') setFormError(e.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return { errors, formError, submitting, submit, setFormError };
}
