import { Button } from './Button';

export function QueryError({ retry, error }: { retry: () => unknown; error?: Error | null }) {
  return <div role="alert" className="rounded-2xl border border-status-critical bg-surface p-5">
    <p className="text-sm">{error?.message || 'Не удалось загрузить данные.'}</p>
    <Button variant="secondary" className="mt-3" onClick={() => void retry()}>Повторить</Button>
  </div>;
}
export function QueryLoading() {
  return <div role="status" className="space-y-4"><span className="sr-only">Загрузка…</span>{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-3xl border border-border bg-surface" />)}</div>;
}
