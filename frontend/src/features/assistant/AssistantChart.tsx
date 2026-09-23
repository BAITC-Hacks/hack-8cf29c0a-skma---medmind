import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAxis, formatNumber, formatPeriod, seriesSlot, seriesStroke, yDomain } from './model';
import type { ChartSpec } from './types';

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, color: 'var(--text-primary)' };
const axis = { fill: 'var(--text-secondary)', fontSize: 12 };

// Tailwind собирает только статичные имена классов — поэтому таблица, а не шаблонная строка.
const SWATCH: Record<number, string> = {
  1: 'border-chart-series-1', 2: 'border-chart-series-2', 3: 'border-chart-series-3', 4: 'border-chart-series-4',
  5: 'border-chart-series-5', 6: 'border-chart-series-6', 7: 'border-chart-series-7', 8: 'border-chart-series-8',
};

/** Кривая из ответа ассистента. Цвет ряда — слот палитры DESIGN.md §2.4 по порядку, прогноз — пунктиром.
 *  Под графиком — таблица значений: слоты 3–5 в светлой теме контрастны < 3:1, нужен не только цвет. */
export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const showDots = spec.data.length <= 14;
  return (
    <figure className="min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <figcaption>
        <p className="text-sm font-semibold">{spec.title}</p>
        {spec.subtitle && <p className="mt-1 text-xs text-text-secondary">{spec.subtitle}</p>}
      </figcaption>
      <p className="mt-3 text-xs text-text-secondary">{spec.y_label}</p>
      <div className="mt-2 h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spec.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey={spec.x_key} tick={axis} tickLine={false} axisLine={false} minTickGap={16} tickFormatter={formatPeriod} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={formatAxis} domain={yDomain(spec.series, spec.data)} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: 'var(--text-primary)' }}
              cursor={{ stroke: 'var(--border)' }}
              labelFormatter={(label) => formatPeriod(label)}
              formatter={(value) => formatNumber(value)}
            />
            {spec.series.map((s, i) => (
              <Line
                key={s.key}
                name={s.name}
                type="monotone"
                dataKey={s.key}
                {...seriesStroke(s, i)}
                dot={showDots ? { r: 2.5, strokeWidth: 0, fill: `var(--chart-series-${seriesSlot(i)})` } : false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-text-secondary" aria-label="Легенда">
        {spec.series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`w-5 ${SWATCH[seriesSlot(i)]} ${s.kind === 'forecast' ? 'border-t-2 border-dashed' : s.kind === 'actual' ? 'border-t-[3px]' : 'border-t-2'}`} />
            {s.name}
          </li>
        ))}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer rounded text-xs text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">Данные графика</summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">{spec.title}</caption>
            <thead className="text-text-secondary">
              <tr>
                <th className="py-2 pr-4 font-medium">Период</th>
                {spec.series.map((s) => <th key={s.key} className="py-2 pr-4 font-medium">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {spec.data.map((row, i) => (
                <tr key={`${String(row[spec.x_key])}-${i}`} className="border-t border-border">
                  <td className="py-1.5 pr-4">{formatPeriod(row[spec.x_key])}</td>
                  {spec.series.map((s) => <td key={s.key} className="py-1.5 pr-4">{formatNumber(row[s.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
