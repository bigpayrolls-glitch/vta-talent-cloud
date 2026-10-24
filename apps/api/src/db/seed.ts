import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Role } from '@vta/shared';
import { loadConfig } from '../config.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { createDb, type DB } from './index.js';

/**
 * Demo data for local development and staging (F-02).
 * - Every organisation, person and phone number here is invented.
 * - Passwords are generated fresh on every run, printed once, and saved to a git-ignored file.
 * - Refuses to run in production or on a database that already has users.
 */

// pnpm runs scripts from apps/api, so the file lands there (git-ignored).
const CREDENTIALS_FILE = path.resolve(process.cwd(), '.seed-credentials.txt');

const genPassword = () => `Vta-${randomBytes(9).toString('base64url')}`;

export interface SeedResult {
  credentials: { role: Role | 'pending'; name: string; login: string; password?: string }[];
  ids: Record<string, string>;
}

export async function seed(db: DB): Promise<SeedResult> {
  const existing = await db.selectFrom('users').select('id').limit(1).execute();
  if (existing.length) throw new Error('Database already has users. Run `pnpm db:reset` to start fresh.');

  const ids: Record<string, string> = {};
  const credentials: SeedResult['credentials'] = [];

  const org = async (key: string, type: 'vta' | 'employer' | 'partner', legal_name: string, verification: 'verified' | 'pending', subtype?: string) => {
    ids[key] = newId();
    await db
      .insertInto('organisations')
      .values({
        id: ids[key],
        type,
        partner_subtype: subtype ?? null,
        legal_name,
        registration_ids: JSON.stringify({}),
        address: 'Bengaluru, Karnataka',
        verification_status: verification,
        verified_at: verification === 'verified' ? new Date() : null,
        status: 'active',
      })
      .execute();
  };

  await org('vta', 'vta', 'VTA (platform operator)', 'verified');
  await org('employerA', 'employer', 'Sunrise Two-Wheeler Service (demo)', 'verified');
  await org('employerB', 'employer', 'Metro Auto Works (demo)', 'verified');
  await org('partnerA', 'partner', 'Skill Bridge Foundation (demo)', 'verified', 'ngo');
  await org('partnerB', 'partner', 'Velocity Training Academy (demo)', 'verified', 'training_provider');
  await org('employerPending', 'employer', 'Green Volt EV Garage (demo)', 'pending');

  const centre = async (key: string, name: string, city: string, organisationKey?: string) => {
    ids[key] = newId();
    await db
      .insertInto('centres')
      .values({ id: ids[key], name, city, organisation_id: organisationKey ? ids[organisationKey]! : null, address: `${city}, Karnataka`, status: 'active' })
      .execute();
  };
  await centre('centreVta', 'VTA Bengaluru Centre', 'Bengaluru');
  await centre('centrePartnerA', 'Skill Bridge Peenya Centre', 'Bengaluru', 'partnerA');
  await centre('centrePartnerB', 'Velocity Mysuru Centre', 'Mysuru', 'partnerB');

  const person = async (
    key: string,
    name: string,
    contact: { email?: string; phone?: string },
    roles: { role: Role; org?: string; centre?: string }[],
    status: 'active' | 'pending' = 'active',
  ) => {
    ids[key] = newId();
    const password = contact.email && status === 'active' ? genPassword() : undefined;
    await db
      .insertInto('users')
      .values({
        id: ids[key],
        name,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        password_hash: password ? await hashPassword(password) : null,
        email_verified_at: contact.email ? new Date() : null,
        phone_verified_at: contact.phone ? new Date() : null,
        status,
      })
      .execute();
    for (const r of roles) {
      await db
        .insertInto('role_assignments')
        .values({
          id: newId(),
          user_id: ids[key],
          role: r.role,
          organisation_id: r.org ? ids[r.org]! : null,
          centre_id: r.centre ? ids[r.centre]! : null,
          granted_by: null,
        })
        .execute();
    }
    credentials.push({ role: roles[0]?.role ?? 'pending', name, login: contact.email ?? contact.phone!, password });
  };

  await person('superAdmin', 'Asha Super Admin', { email: 'superadmin@demo.vta.local' }, [{ role: 'super_admin' }]);
  await person('opsAdmin', 'Vikram Operations', { email: 'ops@demo.vta.local' }, [{ role: 'ops_admin' }]);
  await person('centreAdmin', 'Meena Centre Admin', { email: 'centre@demo.vta.local' }, [{ role: 'centre_admin', centre: 'centreVta' }]);
  await person('employerAdminA', 'Rahul Employer A', { email: 'employer-a@demo.vta.local' }, [{ role: 'employer_admin', org: 'employerA' }]);
  await person('recruiterA', 'Divya Recruiter A', { email: 'recruiter-a@demo.vta.local' }, [{ role: 'employer_recruiter', org: 'employerA' }]);
  await person('employerAdminB', 'Kiran Employer B', { email: 'employer-b@demo.vta.local' }, [{ role: 'employer_admin', org: 'employerB' }]);
  await person('partnerAdminA', 'Farah Partner A', { email: 'partner-a@demo.vta.local' }, [{ role: 'partner_admin', org: 'partnerA' }]);
  await person('partnerViewerA', 'Sanjay Viewer A', { email: 'viewer-a@demo.vta.local' }, [{ role: 'partner_viewer', org: 'partnerA' }]);
  await person('partnerAdminB', 'Lakshmi Partner B', { email: 'partner-b@demo.vta.local' }, [{ role: 'partner_admin', org: 'partnerB' }]);
  await person('trainerA', 'Prakash Trainer', { phone: '+919900000101' }, [{ role: 'trainer', org: 'partnerA', centre: 'centrePartnerA' }]);
  await person('learner', 'Venkatesh Learner', { phone: '+919900000201' }, [{ role: 'learner' }]);
  // A user with two roles, to demonstrate the portal switcher.
  await person('multiRole', 'Nisha Multi-role', { email: 'multi@demo.vta.local' }, [
    { role: 'ops_admin' },
    { role: 'partner_viewer', org: 'partnerB' },
  ]);
  await person('pendingUser', 'Arjun Pending', { email: 'pending@demo.vta.local' }, [], 'pending');

  return { credentials, ids };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data when NODE_ENV=production.');
    process.exit(1);
  }
  const db = createDb(config.databaseUrl);
  try {
    const { credentials } = await seed(db);
    const lines = [
      'VTA Talent Cloud — demo sign-ins (generated by `pnpm db:seed`; regenerated on every reset)',
      'Email users: sign in with email + password. Phone users: sign in with OTP; the code prints in the API console.',
      '',
      ...credentials.map((c) => `${c.role.padEnd(20)} ${c.name.padEnd(22)} ${c.login.padEnd(30)} ${c.password ?? (c.login.startsWith('+') ? '(phone OTP)' : '(no password: awaiting approval)')}`),
    ];
    writeFileSync(CREDENTIALS_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
    console.log(lines.join('\n'));
    console.log(`\nSaved to ${CREDENTIALS_FILE} (git-ignored).`);
  } finally {
    await db.destroy();
  }
}
