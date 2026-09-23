import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCalcRuns } from '../api/client';
import type { CalcRun } from '../api/types';

interface CalcRunContextValue {
  runs: CalcRun[];
  isLoading: boolean;
  selectedRunId: string | null;
  setSelectedRunId: (id: string) => void;
}

const CalcRunContext = createContext<CalcRunContextValue | null>(null);

export function CalcRunProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ['calc-runs'], queryFn: getCalcRuns });
  const runs = data ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  return (
    <CalcRunContext.Provider value={{ runs, isLoading, selectedRunId, setSelectedRunId }}>
      {children}
    </CalcRunContext.Provider>
  );
}

export function useCalcRun(): CalcRunContextValue {
  const ctx = useContext(CalcRunContext);
  if (!ctx) throw new Error('useCalcRun must be used within CalcRunProvider');
  return ctx;
}
