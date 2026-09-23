import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { Select } from '../../shared/ui/Select';
import { Dialog } from '../../shared/ui/Dialog';
import { SalesTrend } from '../../features/sales/SalesTrend';
import {
  categories,
  dateLabel,
  defaultFilters,
  demoEnd,
  demoStart,
  filterSales,
  formatNumber,
  money,
  sales,
  salesCsv,
  sortSales,
  summarizeSales,
  suppliers,
  type Sale,
  type SalesFilters,
  type SalesSort,
} from '../../features/sales/model';

const field =
  'min-h-11 min-w-0 rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none hover:border-accent-text focus-visible:ring-2 focus-visible:ring-accent-focus-ring';
const tabs = [
  { value: '', label: 'Все операции' },
  { value: 'sale', label: 'Продажи' },
  { value: 'return', label: 'Возвраты' },
  { value: 'bulk', label: 'Оптовые' },
];
const sortColumns: { key: SalesSort; label: string }[] = [
  { key: 'date', label: 'Дата / документ' },
  { key: 'name', label: 'Товар' },
  { key: 'quantity', label: 'Количество' },
  { key: 'amount', label: 'Сумма' },
];

function OperationBadge({ row }: { row: Sale }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 py-1.5 text-xs text-text-secondary">
      <Icon
        name={row.operation === 'return' ? 'history' : 'check'}
        width="14"
        height="14"
        className={row.operation === 'return' ? 'text-text-secondary' : 'text-status-good'}
      />
      {row.operation === 'return' ? 'Возврат' : 'Продажа'}
    </span>
  );
}

export function SalesHistoryPage() {
  const [filters, setFilters] = useState<SalesFilters>(defaultFilters);
  const [sort, setSort] = useState<{ key: SalesSort; ascending: boolean }>({ key: 'date', ascending: false });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [active, setActive] = useState<Sale | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download);
    },
    [download],
  );
  const invalidDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const filtered = filterSales(sales, filters);
  const sorted = sortSales(filtered, sort.key, sort.ascending);
  const summary = summarizeSales(filtered);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const beforeKind = filterSales(sales, { ...filters, kind: '' });
  const change = (values: Partial<SalesFilters>) => {
    setFilters((previous) => ({ ...previous, ...values }));
    setPage(1);
    setDownload(null);
  };
  const reset = () => change(defaultFilters);
  const preset = (days: number | null) =>
    change({
      from: days
        ? new Date(Date.parse(`${demoEnd}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
        : demoStart,
      to: demoEnd,
    });
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([salesCsv(sorted)], { type: 'text/csv;charset=utf-8;' }));
    setDownload(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sales-history.csv';
    document.body.append(link);
    link.click();
    link.remove();
  };
  const metrics = [
    {
      label: 'Выручка за период',
      value: money(summary.revenue),
      hint: 'За вычетом возвратов',
      icon: 'dashboard' as const,
    },
    {
      label: 'Документов',
      value: formatNumber(summary.documents),
      hint: 'Продажи и возвраты',
      icon: 'orders' as const,
    },
    {
      label: 'Товарных позиций',
      value: formatNumber(summary.skus),
      hint: 'Уникальные артикулы',
      icon: 'box' as const,
    },
    {
      label: 'Возвратов',
      value: formatNumber(summary.returns),
      hint: 'Документов в выборке',
      icon: 'history' as const,
    },
  ];
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium tracking-widest text-text-secondary">УЧЁТ И АНАЛИТИКА</p>
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
              Демо · тестовые данные
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">История продаж</h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Отгрузки, возвраты и движение спроса в одном журнале.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!filtered.length || invalidDates}>
          <Icon name="download" />
          Экспорт CSV
        </Button>
      </div>
      <section
        aria-label="Фильтры истории продаж"
        className="space-y-4 rounded-3xl border border-border bg-surface p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-[calc(50%-0.375rem)] min-w-0 flex-col gap-2 text-xs text-text-secondary sm:w-auto">
            С даты
            <input
              aria-label="С даты"
              type="date"
              value={filters.from}
              onChange={(event) => change({ from: event.target.value })}
              onBlur={(event) => { if (event.target.value !== filters.from) change({ from: event.target.value }); }}
              aria-invalid={invalidDates}
              aria-describedby={invalidDates ? 'sales-date-error' : undefined}
              className={field}
            />
          </label>
          <label className="flex w-[calc(50%-0.375rem)] min-w-0 flex-col gap-2 text-xs text-text-secondary sm:w-auto">
            По дату
            <input
              aria-label="По дату"
              type="date"
              value={filters.to}
              onChange={(event) => change({ to: event.target.value })}
              onBlur={(event) => { if (event.target.value !== filters.to) change({ to: event.target.value }); }}
              aria-invalid={invalidDates}
              aria-describedby={invalidDates ? 'sales-date-error' : undefined}
              className={field}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { days: 7, label: '7 дней' },
              { days: 30, label: '30 дней' },
              { days: null, label: 'Весь период' },
            ].map((item) => (
              <Button key={item.label} variant="ghost" onClick={() => preset(item.days)} className="!px-3">
                {item.label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-text-secondary sm:ml-auto">Данные по {dateLabel(demoEnd)}</span>
        </div>
        {invalidDates && (
          <p
            id="sales-date-error"
            role="alert"
            className="flex items-center gap-2 text-sm text-text-secondary"
          >
            <Icon name="warning" className="text-status-critical" />
            Начальная дата должна быть не позже конечной.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,2fr)_1fr_1fr]">
          <label className="relative sm:col-span-2 xl:col-span-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-3 text-text-muted"
              width="18"
              height="18"
            />
            <input
              aria-label="Поиск продаж"
              placeholder="Товар, артикул или номер документа"
              value={filters.search}
              onChange={(event) => change({ search: event.target.value })}
              className={`${field} w-full !pl-10`}
            />
          </label>
          <Select
            aria-label="Поставщик продаж"
            value={filters.supplier}
            onChange={(value) => change({ supplier: value })}
            options={[
              { value: '', label: 'Все поставщики' },
              ...suppliers.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
          <Select
            aria-label="Категория продаж"
            value={filters.category}
            onChange={(value) => change({ category: value })}
            options={[
              { value: '', label: 'Все категории' },
              ...categories.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
          <span>Склад: Алматы · суммы в тенге</span>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-accent-subtle-bg active:bg-page-bg focus-visible:outline-accent-focus-ring"
          >
            Сбросить фильтры
          </button>
        </div>
      </section>
      {download && (
        <p role="status" className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
          CSV готов · строк: {filtered.length}.{' '}
          <a
            href={download}
            download="sales-history.csv"
            className="rounded text-accent-text underline hover:text-accent-hover focus-visible:outline-accent-focus-ring"
          >
            Скачать файл
          </a>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((metric) => (
          <section
            key={metric.label}
            className="min-w-0 rounded-3xl border border-border bg-surface p-4 sm:p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xs font-medium text-text-secondary">{metric.label}</h2>
              <Icon name={metric.icon} className="shrink-0 text-accent-text" width="18" height="18" />
            </div>
            <p className="mt-4 break-words text-xl font-semibold tracking-tight sm:text-2xl">
              {metric.value}
            </p>
            <p className="mt-2 text-xs text-text-secondary">{metric.hint}</p>
          </section>
        ))}
      </div>
      <SalesTrend rows={filtered} />
      <section aria-labelledby="sales-journal-title" className="rounded-3xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
          <h2 id="sales-journal-title" className="text-base font-semibold">
            Журнал операций
          </h2>
          <span aria-live="polite" className="text-xs text-text-secondary">
            Найдено {filtered.length} из {sales.length} операций
          </span>
        </div>
        <div className="mx-5 mt-3 flex gap-5 overflow-x-auto sm:mx-6">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={filters.kind === tab.value}
              onClick={() => change({ kind: tab.value })}
              className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 text-sm font-medium hover:text-accent-text active:text-accent-active focus-visible:outline-accent-focus-ring ${filters.kind === tab.value ? 'border-accent-solid text-accent-text' : 'border-transparent text-text-secondary'}`}
            >
              {tab.label}
              <span className="rounded-full bg-page-bg px-2 py-0.5 text-xs tabular-nums">
                {filterSales(beforeKind, { ...filters, kind: tab.value }).length}
              </span>
            </button>
          ))}
        </div>
        {visible.length ? (
          <>
            <div
              className="relative overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Таблица истории продаж"
            >
              <table className="w-full min-w-[960px] text-left text-sm">
                <caption className="sr-only">Продажи и возвраты за выбранный период</caption>
                <thead className="border-y border-border bg-page-bg text-xs text-text-secondary">
                  <tr>
                    {sortColumns.slice(0, 2).map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className="px-5 py-4 font-medium"
                        aria-sort={
                          sort.key === column.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort({
                              key: column.key,
                              ascending: sort.key === column.key ? !sort.ascending : true,
                            })
                          }
                          className="flex items-center gap-2 rounded hover:text-accent-text focus-visible:outline-accent-focus-ring"
                        >
                          {column.label}
                          <Icon name="sort" width="13" height="13" />
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="px-3 font-medium">
                      Поставщик
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      Операция
                    </th>
                    {sortColumns.slice(2).map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className="px-3 py-4 text-right font-medium"
                        aria-sort={
                          sort.key === column.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort({
                              key: column.key,
                              ascending: sort.key === column.key ? !sort.ascending : true,
                            })
                          }
                          className="ml-auto flex items-center gap-2 rounded hover:text-accent-text focus-visible:outline-accent-focus-ring"
                        >
                          {column.label}
                          <Icon name="sort" width="13" height="13" />
                        </button>
                      </th>
                    ))}
                    <th scope="col">
                      <span className="sr-only">Подробности</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} className="border-b border-border hover:bg-page-bg">
                      <td className="whitespace-nowrap px-5 py-4">
                        <span className="block text-xs font-medium tabular-nums">{dateLabel(row.date)}</span>
                        <button
                          type="button"
                          onClick={() => setActive(row)}
                          className="mt-1.5 rounded text-xs text-accent-text hover:underline focus-visible:outline-accent-focus-ring"
                        >
                          {row.document}
                        </button>
                      </td>
                      <td className="max-w-80 px-5 py-4">
                        <button
                          type="button"
                          onClick={() => setActive(row)}
                          className="rounded text-left text-sm font-medium hover:text-accent-text focus-visible:outline-accent-focus-ring"
                        >
                          {row.name}
                        </button>
                        <p className="mt-1.5 text-xs text-text-secondary">
                          {row.sku} · {row.category}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-xs">{row.supplier}</td>
                      <td className="px-3 py-4">
                        <OperationBadge row={row} />
                        {row.bulk && (
                          <span className="mt-1.5 block text-xs text-text-secondary">Оптовая отгрузка</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">
                        {row.operation === 'return' ? '−' : ''}
                        {formatNumber(row.quantity)}{' '}
                        <span className="text-xs text-text-secondary">{row.unit}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-right font-medium tabular-nums">
                        {money(row.amount)}
                      </td>
                      <td className="pr-4">
                        <button
                          type="button"
                          aria-label={`Открыть ${row.document}`}
                          onClick={() => setActive(row)}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary hover:bg-accent-subtle-bg hover:text-accent-text focus-visible:outline-accent-focus-ring"
                        >
                          <Icon name="chevron" width="16" height="16" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs text-text-secondary sm:px-6">
              <div className="flex items-center gap-3">
                <span>
                  {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} из{' '}
                  {filtered.length}
                </span>
                <Select
                  aria-label="Операций на странице"
                  value={String(pageSize)}
                  onChange={(value) => {
                    setPageSize(Number(value));
                    setPage(1);
                  }}
                  options={[10, 25, 50].map((size) => ({ value: String(size), label: `По ${size}` }))}
                  className="!min-h-9 !rounded-xl !py-1 !text-xs"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  aria-label="Предыдущая страница продаж"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  className="!min-h-9 !px-2 !py-1"
                >
                  <Icon name="chevron" className="rotate-180" width="16" height="16" />
                </Button>
                <span aria-live="polite">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  aria-label="Следующая страница продаж"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className="!min-h-9 !px-2 !py-1"
                >
                  <Icon name="chevron" width="16" height="16" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 py-14 text-center">
            <Icon name="search" className="mx-auto mb-4 text-accent-text" width="32" height="32" />
            <h3 className="text-lg font-semibold">
              {invalidDates ? 'Проверьте период' : 'Операции не найдены'}
            </h3>
            <p className="mb-5 mt-2 text-sm text-text-secondary">
              {invalidDates
                ? 'Начальная дата должна быть не позже конечной.'
                : 'Попробуйте изменить период или условия поиска.'}
            </p>
            <Button variant="secondary" onClick={reset}>
              Сбросить фильтры
            </Button>
          </div>
        )}
      </section>
      <p className="flex items-start gap-2 text-xs leading-5 text-text-secondary">
        <Icon name="info" width="16" height="16" className="mt-0.5 shrink-0" />
        Тестовый журнал за {dateLabel(demoStart)}–{dateLabel(demoEnd)}. Все операции вымышлены. Возвраты
        уменьшают выручку; оптовые отгрузки включены в итог. Backend не подключён.
      </p>
      {active && (
        <Dialog drawer labelledBy="sale-detail-title" onClose={() => setActive(null)}>
          <div className="flex items-center justify-between border-b border-border p-6">
            <div>
              <p className="mb-2 text-xs text-text-secondary">Детали операции</p>
              <h2 id="sale-detail-title" className="text-xl font-semibold">
                {active.document}
              </h2>
            </div>
            <Button
              variant="ghost"
              aria-label="Закрыть операцию"
              onClick={() => setActive(null)}
              className="!px-3"
            >
              <Icon name="close" />
            </Button>
          </div>
          <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <OperationBadge row={active} />
              <span className="text-sm text-text-secondary">{dateLabel(active.date)}</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold leading-7">{active.name}</h3>
              <p className="mt-2 text-sm text-text-secondary">{active.category}</p>
            </div>
            <dl className="divide-y divide-border text-sm">
              {[
                ['Код 1С', active.sku],
                ['Артикул поставщика', active.supplierSku],
                ['Поставщик', active.supplier],
                ['Склад', 'Алматы'],
                [
                  'Тип отгрузки',
                  active.bulk ? 'Оптовая' : active.operation === 'return' ? 'Возврат товара' : 'Регулярная',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-3">
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-2xl bg-page-bg p-5">
              <p className="text-sm text-text-secondary">
                {formatNumber(active.quantity)} {active.unit} × {money(active.price)}
              </p>
              <p className="mt-3 text-3xl font-semibold">{money(active.amount)}</p>
              <p className="mt-3 text-xs leading-5 text-text-secondary">
                {active.operation === 'return'
                  ? 'Возврат: эта сумма вычитается из выручки за период.'
                  : 'Сумма реализации по тестовому документу.'}
              </p>
            </div>
            <p className="flex items-start gap-2 text-xs leading-5 text-text-secondary">
              <Icon name="info" className="shrink-0" width="16" height="16" />
              {active.bulk
                ? 'Оптовая отгрузка помечена в тестовых данных. Это не результат автоматического поиска аномалий.'
                : 'Демонстрационный документ. Данные покупателей не используются.'}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
