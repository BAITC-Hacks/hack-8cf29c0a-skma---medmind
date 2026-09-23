import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Select } from '../../shared/ui/Select';

interface Report { applied: boolean; counts: Record<string, number>; warnings: string[] }
const labels: Record<string, string> = { products: 'Товары', sales: 'Продажи', stock_monthly: 'Месячные остатки', stock_current: 'Текущие остатки', transit: 'Товары в пути', supplier_rules: 'Правила заказа', seasonality: 'Сезонная выручка' };

export function SupplierImport() {
  const cache = useQueryClient();
  const [supplier, setSupplier] = useState('iek');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function reset() { setReport(null); setConfirmed(false); setError(''); }
  async function upload(apply: boolean) {
    if (!file || busy) return;
    if (file.size > 64 * 1024 * 1024) { setError('Размер архива не должен превышать 64 МБ.'); return; }
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.set('file', file); body.set('dry_run', String(!apply)); body.set('replace_supplier', String(apply && confirmed));
      const response = await fetch(`${API_BASE}/imports/supplier-bundle/${supplier}`, { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Не удалось прочитать отчёты. Проверьте комплект файлов.');
      setReport(result);
      if (result.applied) await cache.invalidateQueries();
    } catch (failure) { setReport(null); setConfirmed(false); setError(failure instanceof Error ? failure.message : 'Не удалось загрузить отчёты. Повторите попытку.'); }
    finally { setBusy(false); }
  }
  return <details className="rounded-3xl border border-border bg-surface p-5">
    <summary className="cursor-pointer rounded text-lg font-semibold focus-visible:ring-2 focus-visible:ring-accent-focus-ring">Загрузить отчёты поставщика</summary>
    <p className="mt-3 text-sm text-text-secondary">ZIP-архив с Excel-отчётами о продажах, остатках, поставках и условиях заказа. Сначала проверьте комплект, затем подтвердите загрузку.</p>
    <fieldset disabled={busy} className="mt-4 space-y-4">
      <Select aria-label="Поставщик отчётов" value={supplier} onChange={value => { setSupplier(value); setFile(null); reset(); }} options={[{ value: 'iek', label: 'IEK' }, { value: 'se', label: 'Systeme Electric' }]} />
      <label className="block text-sm">Архив отчётов<input key={supplier} type="file" accept=".zip" onChange={e => { setFile(e.target.files?.[0] ?? null); reset(); }} className="mt-2 block w-full text-sm file:mr-3 file:rounded-xl file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-text-primary" /></label>
      {error && <p role="alert" className="rounded-2xl border border-status-critical p-4 text-sm">{error}</p>}
      {report && <div role="status" className="space-y-3 rounded-2xl border border-border p-4 text-sm"><p className="font-semibold">{report.applied ? 'Отчёты загружены. Запустите пересчёт для обновления рекомендаций.' : 'Комплект проверен. Изменения ещё не сохранены.'}</p><ul>{Object.entries(report.counts).map(([key, count]) => <li key={key}>{labels[key] ?? key}: {count.toLocaleString('ru-RU')}</li>)}</ul>{report.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      {report && !report.applied && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 accent-accent-solid" />Заменить исходные данные этого поставщика, включая ручные изменения. История заказов сохранится.</label>}
      <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={!file} onClick={() => void upload(false)}>{busy ? 'Обработка…' : 'Проверить комплект'}</Button>{report && !report.applied && <Button disabled={!confirmed} onClick={() => void upload(true)}>Подтвердить загрузку</Button>}</div>
    </fieldset>
  </details>;
}
