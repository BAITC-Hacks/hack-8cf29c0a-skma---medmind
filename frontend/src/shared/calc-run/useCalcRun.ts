import { createContext, useContext } from 'react';
import type { CalcRun } from '../api/types';

interface CalcRunContextValue {
  runs: CalcRun[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
  selectedRunId: string | null;
  setSelectedRunId: (id: string) => void;
}

export const CalcRunContext = createContext<CalcRunContextValue | null>(null);

export function useCalcRun(): CalcRunContextValue {
  const context = useContext(CalcRunContext);
  if (!context) throw new Error('useCalcRun must be used within CalcRunProvider');
  return context;
}
