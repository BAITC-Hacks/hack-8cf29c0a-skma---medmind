import type { CalcRun } from './types';
import calcRunsFixture from './fixtures/calc-runs.json';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export async function getCalcRuns(): Promise<CalcRun[]> {
  if (USE_MOCK) {
    return calcRunsFixture as CalcRun[];
  }
  const res = await fetch(`${API_BASE}/calc-runs`);
  if (!res.ok) {
    throw new Error(`Failed to load calc runs: ${res.status}`);
  }
  return (await res.json()) as CalcRun[];
}
