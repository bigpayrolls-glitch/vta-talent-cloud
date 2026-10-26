import { z } from 'zod';

/**
 * Must be the first import of the app: Zod checks whether eval is allowed when schemas are created.
 * The site's Content Security Policy forbids eval, and the check itself is reported as a violation.
 */
z.config({ jitless: true });
