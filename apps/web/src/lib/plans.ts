import { useQuery } from '@tanstack/react-query';
import { PLAN_INFO, type PlanTable } from '@vta/shared';
import { api } from './api';

/**
 * Plans as AutoTalent Grid has set them in Admin > Plans. Until they load, the built-in plans are shown, so the
 * page never waits on this.
 */
export function usePlans(): PlanTable {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ employer: PlanTable }>('/plans'), staleTime: 60_000 });
  return q.data?.employer ?? PLAN_INFO;
}
