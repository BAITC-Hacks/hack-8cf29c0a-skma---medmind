import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCalcRuns } from '../api/client';
import { CalcRunContext } from './useCalcRun';

export function CalcRunProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['calc-runs'], queryFn: getCalcRuns });
  const runs = data ?? [];
  const [chosenRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRunId = runs.find((run) => run.id === chosenRunId)?.id ?? runs[0]?.id ?? null;

  return (
    <CalcRunContext.Provider
      value={{
        runs,
        isLoading,
        isError,
        retry: () => {
          void refetch();
        },
        selectedRunId,
        setSelectedRunId,
      }}
    >
      {children}
    </CalcRunContext.Provider>
  );
}
