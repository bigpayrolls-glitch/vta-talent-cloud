import { PLAN_INFO, PLANS, type Plan, type PlanInfo, type PlanTable } from '@vta/shared';
import type { DB } from '../db/index.js';

/**
 * Plan details as AutoTalent Grid has set them in Admin > Plans (table plan_catalogue). Each plan starts from
 * PLAN_INFO; a saved row replaces it. Kept for 30 seconds per server instance, and cleared here on a change,
 * so limits and prices follow an edit within half a minute everywhere.
 */
const TTL_MS = 30_000;
let cache: { at: number; employer: PlanTable } | null = null;

export async function employerPlans(db: DB): Promise<PlanTable> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.employer;
  const rows = await db.selectFrom('plan_catalogue').select(['code', 'info']).where('audience', '=', 'employer').execute();
  const table = { ...PLAN_INFO } as PlanTable;
  for (const r of rows) {
    if ((PLANS as readonly string[]).includes(r.code)) table[r.code as Plan] = { ...PLAN_INFO[r.code as Plan], ...(r.info as Partial<PlanInfo>) };
  }
  cache = { at: Date.now(), employer: table };
  return table;
}

export async function employerPlan(db: DB, plan: Plan): Promise<PlanInfo> {
  return (await employerPlans(db))[plan];
}

export function clearPlanCache(): void {
  cache = null;
}
