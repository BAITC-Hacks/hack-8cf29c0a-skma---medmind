import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../../shared/api/client';
import { getOrderLookups } from '../../shared/api/orders';
import { useCalcRun } from '../../shared/calc-run/useCalcRun';
import { Icon } from '../../shared/ui/Icon';
import { Select } from '../../shared/ui/Select';
import { QueryError, QueryLoading } from '../../shared/ui/QueryState';

interface Dashboard {
  summary: { orders: number; high: number; suppliers: number };
  trend: { period: string; actual_qty: number | null; forecast_qty: number | null }[];
  seasonality: { month: number; factor: number }[];
  risks: { id: string; sku: string; name: string; supplier: string; unit: string; quantity: number; days_of_cover: number | null; reason: string }[];
}
const panel = 'rounded-3xl border border-border bg-surface p-5 sm:p-6';
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, color: 'var(--text-primary)' };
const axis = { fill: 'var(--text-secondary)', fontSize: 12 };
const number = (n: number | null) => n === null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export function DashboardPage() {
  const { runs, selectedRunId, isLoading, isError, retry } = useCalcRun();
  const [category, setCategory] = useState('');
  const [months, setMonths] = useState('12');
  const run = runs.find(item => item.id === selectedRunId);
  const lookups = useQuery({ queryKey: ['order-lookups'], queryFn: getOrderLookups });
  const query = useQuery({ queryKey: ['dashboard', selectedRunId, category, months], enabled: run?.status === 'done',
    queryFn: () => request<Dashboard>(`/analytics/dashboard?${new URLSearchParams({ run_id: selectedRunId!, months, ...(category ? { category_id: category } : {}) })}`) });
  if (isError) return <QueryError retry={retry} />;
  if (isLoading) return <QueryLoading />;
  if (!run) return <div className={panel}><h1 className="text-2xl font-semibold">Дашборд</h1><p className="mt-3 text-text-secondary">Запустите первый расчёт, чтобы увидеть аналитику.</p></div>;
  if (run.status !== 'done') return <div role="status" className={panel}><h1 className="text-2xl font-semibold">Аналитика пока недоступна</h1><p className="mt-3 text-text-secondary">{run.status === 'failed' ? 'Расчёт завершился с ошибкой. Запустите его повторно.' : 'Расчёт выполняется…'}</p></div>;
  const data = query.data;
  const date = new Date(run.created_at).toLocaleDateString('ru-RU');
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold">Дашборд</h1><p className="mt-2 text-sm text-text-secondary">Спрос, закупки и риски дефицита · расчёт от {date}</p></div><Select aria-label="Категория аналитики" options={[{ value: '', label: 'Все категории' }, ...(lookups.data?.categories ?? []).map(c => ({ value: c.id, label: c.name }))]} value={category} onChange={setCategory} /></header>
    {lookups.isError && <QueryError error={lookups.error} retry={lookups.refetch} />}
    {query.isPending ? <QueryLoading /> : query.isError ? <QueryError error={query.error} retry={query.refetch} /> : data && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Позиций к заказу', number(data.summary.orders)], ['Высокая срочность', number(data.summary.high)], ['Поставщиков', number(data.summary.suppliers)], ['Дата расчёта', date]].map(([label, value]) => <section key={label} className={panel}><h2 className="text-sm text-text-secondary">{label}</h2><p className="my-4 text-3xl font-semibold">{value}</p><p className="text-xs text-text-secondary">В выбранном расчёте и категории</p></section>)}</div>
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <section className={panel + ' min-w-0'}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold">Тренд спроса</h2><Select aria-label="Период тренда" options={[{ value: '12', label: '12 месяцев' }, { value: '24', label: '24 месяца' }, { value: '36', label: '36 месяцев' }]} value={months} onChange={setMonths} /></div><p className="mt-3 text-xs text-text-secondary">Объём отгрузок и прогноз по месяцам. Сумма учётных единиц товаров.</p>
          {data.trend.length ? <><div className="mt-5 h-64 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="period" tick={axis} minTickGap={25} /><YAxis tick={axis} width={60} /><Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text-primary)' }} /><Line name="Факт" dataKey="actual_qty" stroke="var(--chart-series-1)" strokeWidth={3} dot={false} /><Line name="Прогноз" dataKey="forecast_qty" stroke="var(--chart-series-2)" strokeWidth={2} strokeDasharray="6 5" dot={false} /></LineChart></ResponsiveContainer></div><div className="flex justify-center gap-6 text-xs text-text-secondary"><span className="flex items-center gap-2"><span className="w-5 border-t-[3px] border-chart-series-1" />Факт</span><span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-chart-series-2" />Прогноз</span></div><details className="mt-5 text-sm"><summary className="cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-accent-focus-ring">Данные графика</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left tabular-nums"><thead className="text-text-secondary"><tr><th>Месяц</th><th>Факт</th><th>Прогноз</th></tr></thead><tbody>{data.trend.map(p => <tr key={p.period} className="border-t border-border"><td className="py-2">{p.period}</td><td>{number(p.actual_qty)}</td><td>{number(p.forecast_qty)}</td></tr>)}</tbody></table></div></details></> : <p className="py-12 text-center text-text-secondary">Нет данных о спросе.</p>}
          {!data.trend.some(p => p.forecast_qty !== null) && <p className="mt-4 text-sm text-text-secondary">Прогноз для этого расчёта отсутствует. Запустите пересчёт, чтобы его сформировать.</p>}
        </section>
        <section className={panel + ' min-w-0'}><h2 className="text-lg font-semibold">Сезонность</h2><p className="mt-1 text-xs text-text-secondary">Коэффициент по месяцам · 1 = базовый уровень</p>{data.seasonality.length ? <><div className="mt-8 h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.seasonality} margin={{ top: 24 }} accessibilityLayer><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="month" tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--page-bg)' }} /><ReferenceLine y={1} stroke="var(--text-secondary)" strokeDasharray="4 4" /><Bar name="Коэффициент" dataKey="factor" fill="var(--chart-sequential-500)" radius={[5, 5, 0, 0]}><LabelList dataKey="factor" position="top" fill="var(--text-secondary)" fontSize={10} /></Bar></BarChart></ResponsiveContainer></div><p className="mt-4 text-xs text-text-secondary">Значение выше 1 означает спрос выше базового.</p></> : <p className="py-12 text-center text-text-secondary">Коэффициенты не рассчитаны. Запустите пересчёт для выбранных товаров.</p>}</section>
      </div>
      <section className={panel}><h2 className="text-lg font-semibold">Риск дефицита</h2><p className="mt-2 text-sm text-text-secondary">До 10 позиций высокой срочности · всего {data.summary.high}</p>{data.risks.length ? <div className="mt-4 divide-y divide-border">{data.risks.map(p => <article key={p.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><Link to={`/orders?order=${encodeURIComponent(p.id)}`} className="rounded font-semibold text-accent-text hover:underline active:text-accent-active focus-visible:ring-2 focus-visible:ring-accent-focus-ring">{p.name}</Link><span className="flex items-center gap-2 text-xs text-text-secondary"><Icon name="clock" className="text-status-critical" width={16} height={16} />Высокая срочность</span></div><p className="mt-1 text-xs text-text-secondary">{p.sku} · {p.supplier}</p><p className="mt-3 text-sm">{p.reason}</p><p className="mt-2 text-sm text-text-secondary">Запас на {number(p.days_of_cover)} дн. · К заказу: {number(p.quantity)} {p.unit}</p></article>)}</div> : <p className="py-8 text-text-secondary">Позиций высокой срочности нет.</p>}</section>
    </>}
  </div>;
}
