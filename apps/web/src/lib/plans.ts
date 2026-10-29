import { useQuery } from '@tanstack/react-query';
import { PARTNER_PLAN_INFO, PLAN_INFO, type PartnerPlanTable, type PlanTable } from '@vta/shared';
import { api } from './api';

/**
 * Plans as AutoTalent Grid has set them in Admin > Plans. Until they load, the built-in plans are shown, so the
 * page never waits on this.
 */
function usePlanQuery() {
  return useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ employer: PlanTable; partner: PartnerPlanTable }>('/plans'), staleTime: 60_000 });
}

export function usePlans(): PlanTable {
  return usePlanQuery().data?.employer ?? PLAN_INFO;
}

export function usePartnerPlans(): PartnerPlanTable {
  return usePlanQuery().data?.partner ?? PARTNER_PLAN_INFO;
}
