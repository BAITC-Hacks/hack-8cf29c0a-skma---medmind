export type CalcRunStatus = 'running' | 'done' | 'failed';

export interface CalcRun {
  id: string;
  created_at: string;
  horizon_days: number;
  status: CalcRunStatus;
}
