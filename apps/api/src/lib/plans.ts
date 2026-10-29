import { PARTNER_PLAN_INFO, PARTNER_PLANS, PLAN_INFO, PLANS, type PartnerPlan, type PartnerPlanInfo, type PartnerPlanTable, type Plan, type PlanInfo, type PlanTable } from '@vta/shared';
import type { DB } from '../db/index.js';

/**
 * Plan details as AutoTalent Grid has set them in Admin > Plans (table plan_catalogue). Each plan starts from
 * PLAN_INFO; a saved row replaces it. Kept for 30 seconds per server instance, and cleared here on a change,
 * so limits and prices follow an edit within half a minute everywhere.
 */
const TTL_MS = 30_000;
let cache: { at: number; employer: PlanTable; partner: PartnerPlanTable } | null = null;

async function load(db: DB) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const rows = await db.selectFrom('plan_catalogue').select(['audience', 'code', 'info']).execute();
  const employer = { ...PLAN_INFO } as PlanTable;
  const partner = { ...PARTNER_PLAN_INFO } as PartnerPlanTable;
  for (const r of rows) {
    if (r.audience === 'employer' && (PLANS as readonly string[]).includes(r.code)) employer[r.code as Plan] = { ...PLAN_INFO[r.code as Plan], ...(r.info as Partial<PlanInfo>) };
    if (r.audience === 'partner' && (PARTNER_PLANS as readonly string[]).includes(r.code)) partner[r.code as PartnerPlan] = { ...PARTNER_PLAN_INFO[r.code as PartnerPlan], ...(r.info as Partial<PartnerPlanInfo>) };
  }
  cache = { at: Date.now(), employer, partner };
  return cache;
}

export async function employerPlans(db: DB): Promise<PlanTable> {
  return (await load(db)).employer;
}

export async function partnerPlans(db: DB): Promise<PartnerPlanTable> {
  return (await load(db)).partner;
}

export async function partnerPlan(db: DB, plan: PartnerPlan): Promise<PartnerPlanInfo> {
  return (await load(db)).partner[plan];
}

export async function employerPlan(db: DB, plan: Plan): Promise<PlanInfo> {
  return (await employerPlans(db))[plan];
}

export function clearPlanCache(): void {
  cache = null;
}
