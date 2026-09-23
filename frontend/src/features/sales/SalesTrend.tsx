import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dateLabel, money, salesTrend, type Sale } from './model';

export function SalesTrend({ rows }: { rows: Sale[] }) {
  const data = salesTrend(rows);
  return (
    <section
      className="min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-6"
      aria-labelledby="sales-trend-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sales-trend-title" className="text-base font-semibold">
            Динамика продаж
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Выручка по дням с учётом возвратов · по выбранным фильтрам
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-series-1" />
          Выручка, ₸
        </span>
      </div>
      {data.length ? (
        <>
          <div className="mt-5 h-44 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) => dateLabel(String(date)).slice(0, 5)}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  width={52}
                  tickFormatter={(value) => `${Number(value) / 1000}к`}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value) => money(Number(value))}
                  labelFormatter={(label) => dateLabel(String(label))}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    color: 'var(--text-primary)',
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ fill: 'var(--page-bg)' }}
                />
                <ReferenceLine y={0} stroke="var(--text-secondary)" />
                <Bar
                  name="Выручка"
                  dataKey="amount"
                  fill="var(--chart-series-1)"
                  maxBarSize={32}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-xs text-text-secondary">
            <summary className="w-fit cursor-pointer rounded-lg py-2 focus-visible:outline-accent-focus-ring">
              Показать значения по дням
            </summary>
            <div className="relative mt-2 max-h-48 overflow-auto">
              <table className="w-full text-left tabular-nums">
                <caption className="sr-only">Выручка по дням</caption>
                <thead>
                  <tr>
                    <th className="py-2">Дата</th>
                    <th className="text-right">Выручка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((day) => (
                    <tr key={day.date} className="border-t border-border">
                      <td className="py-2">{dateLabel(day.date)}</td>
                      <td className="text-right">{money(day.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="flex h-44 items-center justify-center text-sm text-text-secondary">
          Нет данных для графика
        </p>
      )}
    </section>
  );
}
