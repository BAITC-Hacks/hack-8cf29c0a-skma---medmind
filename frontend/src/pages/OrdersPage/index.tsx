import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCalcRun } from '../../shared/calc-run/useCalcRun';
import { API_BASE, USE_MOCK } from '../../shared/api/client';
import { decideOrder, getOrderLookups, getRecommendations } from '../../shared/api/orders';
import type { CalcRun, OrderRecommendation } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Select } from '../../shared/ui/Select';
import { Dialog } from '../../shared/ui/Dialog';
import { MultiSelect } from '../../features/orders/MultiSelect';
import { OrdersTable } from '../../features/orders/OrdersTable';
import {
  emptyFilters,
  filterOrders,
  inputClass,
  number,
  ordersToCsv,
  parseQuantity,
  sortOrders,
  urgencyLabels,
  type OrderFilters,
  type SortKey,
} from '../../features/orders/model';
import { OrderDetailDrawer } from '../OrderDetailDrawer';

type Decision = {
  order: OrderRecommendation;
  quantity: number;
  status: 'approved' | 'rejected';
  comment: string;
};
type OrdersData = Awaited<ReturnType<typeof loadOrders>>;
async function loadOrders(runId: string) {
  const [orders, lookups] = await Promise.all([getRecommendations(runId), getOrderLookups()]);
  return { orders, ...lookups };
}
const statusTabs = [
  { value: '', label: 'Все позиции' },
  { value: 'pending', label: 'Ожидают' },
  { value: 'approved', label: 'Утверждены' },
  { value: 'rejected', label: 'Отклонены' },
];

function LoadingOrders() {
  return (
    <div role="status" className="space-y-6">
      <span className="sr-only">Загрузка заказов</span>
      <div className="h-12 w-64 animate-pulse rounded-2xl bg-border" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-3xl border border-border bg-surface" />
        ))}
      </div>
      <div className="space-y-4 rounded-3xl border border-border bg-surface p-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-page-bg" />
        ))}
      </div>
    </div>
  );
}

export function OrdersPage() {
  const { runs, selectedRunId, isLoading, isError, retry } = useCalcRun();
  const run = runs.find((item) => item.id === selectedRunId);
  if (isLoading || (!selectedRunId && runs.length > 0)) return <LoadingOrders />;
  if (isError)
    return (
      <section role="alert" className="rounded-3xl border border-border bg-surface p-8">
        <h1 className="text-2xl font-semibold">Не удалось загрузить расчёты</h1>
        <p className="mb-5 mt-3 text-sm text-text-secondary">Проверьте подключение и попробуйте снова.</p>
        <Button variant="secondary" onClick={retry}>
          Повторить
        </Button>
      </section>
    );
  if (!run || run.status !== 'done')
    return (
      <section className="rounded-3xl border border-border bg-surface px-6 py-16 text-center">
        <Icon
          name={run?.status === 'failed' ? 'warning' : 'clock'}
          className="mx-auto mb-4 text-text-secondary"
          width="32"
          height="32"
        />
        <h1 className="text-2xl font-semibold">
          {!run
            ? 'Нет доступных расчётов'
            : run.status === 'failed'
              ? 'Расчёт завершился с ошибкой'
              : 'Расчёт ещё выполняется'}
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          Выберите готовый расчёт в верхней панели, чтобы увидеть рекомендации.
        </p>
      </section>
    );
  return <OrdersWorkspace key={run.id} run={run} />;
}

function OrdersWorkspace({ run }: { run: CalcRun }) {
  const queryClient = useQueryClient();
  const queryKey = ['orders', run.id];
  const query = useQuery({ queryKey, queryFn: () => loadOrders(run.id), retry: 1 });
  const [filters, setFilters] = useState<OrderFilters>(emptyFilters);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'urgency',
    direction: 'asc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Decision[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFile, setExportFile] = useState<{ url: string; name: string; count: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(
    () => () => {
      if (exportFile?.url.startsWith('blob:')) URL.revokeObjectURL(exportFile.url);
    },
    [exportFile],
  );
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const mutation = useMutation({
    onMutate: () => setNotice(null),
    mutationFn: async (decisions: Decision[]) => {
      const results = await Promise.allSettled(
        decisions.map((item) => decideOrder(item.order, item.quantity, item.status, item.comment)),
      );
      return { results, decisions };
    },
    onSuccess: ({ results, decisions }) => {
      const updated = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      const failed = results.filter((result) => result.status === 'rejected');
      queryClient.setQueryData<OrdersData>(
        queryKey,
        (previous) =>
          previous && {
            ...previous,
            orders: previous.orders.map((order) => updated.find((item) => item.id === order.id) ?? order),
          },
      );
      setSelected(
        (previous) => new Set([...previous].filter((id) => !updated.some((order) => order.id === id))),
      );
      setDrafts((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) => !updated.some((order) => order.id === id)),
        ),
      );
      setConfirm(null);
      if (!failed.length) setActiveId(null);
      setNotice({
        error: failed.length > 0,
        text: failed.length
          ? `Сохранено: ${updated.length}. Не удалось сохранить: ${failed.length}. Повторите действие для оставшихся позиций.`
          : decisions[0]?.status === 'rejected'
            ? 'Рекомендация отклонена.'
            : `Утверждено позиций: ${updated.length}. Заказ поставщику не отправлен.`,
      });
    },
  });

  if (query.isPending) return <LoadingOrders />;
  if (query.isError)
    return (
      <section role="alert" className="rounded-3xl border border-border bg-surface p-8">
        <Icon name="warning" className="mb-4 text-status-critical" />
        <h1 className="text-2xl font-semibold">Не удалось загрузить заказы</h1>
        <p className="mb-5 mt-3 text-sm text-text-secondary">{query.error.message}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Повторить
        </Button>
      </section>
    );

  const { orders, suppliers, categories } = query.data;
  const categoryNames = Object.fromEntries(categories.map((category) => [category.id, category.name]));
  const filtered = filterOrders(orders, filters);
  // Keep supplier groups together across pages; sort rows within each group.
  const sorted = suppliers.flatMap((supplier) =>
    sortOrders(
      filtered.filter((order) => order.supplier_id === supplier.id),
      sort.key,
      sort.direction,
      drafts,
      categoryNames,
    ),
  );
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedRows = filtered.filter((order) => selected.has(order.id));
  const pendingSelected = selectedRows.filter((order) => order.status === 'pending');
  const activeOrder = orders.find((order) => order.id === activeId);
  const draft = (order: OrderRecommendation) =>
    drafts[order.id] ?? String(order.approved_qty ?? order.recommended_qty);
  const invalidSelected = pendingSelected.some((order) => parseQuantity(draft(order)) === null);
  const hasFilters =
    filters.search !== '' ||
    filters.suppliers.length > 0 ||
    filters.categories.length > 0 ||
    filters.urgency !== '' ||
    filters.status !== '';
  const changeFilters = (changes: Partial<OrderFilters>) => {
    setFilters((previous) => ({ ...previous, ...changes }));
    setPage(1);
    setSelected(new Set());
  };
  const toggleRows = (rows: OrderRecommendation[], checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      rows.forEach((order) => {
        if (checked) next.add(order.id);
        else next.delete(order.id);
      });
      return next;
    });
  const changeSort = (key: SortKey) => {
    setSort((previous) => ({
      key,
      direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc',
    }));
    setPage(1);
  };
  const startApprove = () =>
    setConfirm(
      pendingSelected.map((order) => ({
        order,
        quantity: parseQuantity(draft(order))!,
        status: 'approved',
        comment: order.comment ?? '',
      })),
    );
  const exportRows = async (rows: OrderRecommendation[]) => {
    setExporting(true);
    try {
      let url: string;
      if (USE_MOCK)
        url = URL.createObjectURL(
          new Blob([ordersToCsv(rows, categoryNames)], { type: 'text/csv;charset=utf-8;' }),
        );
      else {
        const response = await fetch(`${API_BASE}/recommendations/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: rows.map((order) => order.id), format: 'csv' }),
        });
        if (!response.ok) throw new Error('Не удалось подготовить файл. Повторите экспорт.');
        const data = (await response.json()) as { download_url: string };
        url = data.download_url;
      }
      const name = `orders-${run.id}.csv`;
      setExportFile({ url, name, count: rows.length });
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setNotice({ text: `CSV подготовлен. Позиций: ${rows.length}.`, error: false });
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Не удалось экспортировать заказы.',
        error: true,
      });
    } finally {
      setExporting(false);
    }
  };
  const kpis: { label: string; value: number; hint: string; icon: IconName; color: string }[] = [
    {
      label: 'Позиций к заказу',
      value: orders.length,
      hint: `Горизонт — ${run.horizon_days} дней`,
      icon: 'box',
      color: 'text-accent-text',
    },
    {
      label: 'Высокая срочность',
      value: orders.filter((order) => order.urgency === 'high').length,
      hint: 'Требуют внимания в первую очередь',
      icon: 'warning',
      color: 'text-status-critical',
    },
    {
      label: 'Ожидают решения',
      value: orders.filter((order) => order.status === 'pending').length,
      hint: 'Проверьте и согласуйте количество',
      icon: 'clock',
      color: 'text-text-secondary',
    },
    {
      label: 'Поставщиков',
      value: new Set(orders.map((order) => order.supplier_id)).size,
      hint: 'Рекомендации сгруппированы',
      icon: 'truck',
      color: 'text-accent-text',
    },
  ];
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium tracking-widest text-text-secondary">УПРАВЛЕНИЕ ЗАКУПКАМИ</p>
            {USE_MOCK && (
              <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                Демо · тестовые данные
              </span>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Заказы</h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Рекомендации к закупке — от расчёта до согласования.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void exportRows(selectedRows.length ? selectedRows : filtered)}
          disabled={!filtered.length || exporting || mutation.isPending}
        >
          <Icon name="download" />
          {exporting
            ? 'Подготовка…'
            : selectedRows.length
              ? `Экспорт выбранных · ${selectedRows.length}`
              : 'Экспорт CSV'}
        </Button>
      </div>
      {exportFile && (
        <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
          <Icon name="check" className="text-status-good" width="16" height="16" />
          Файл готов · позиций: {exportFile.count}.
          <a
            href={exportFile.url}
            download={exportFile.name}
            className="rounded-md font-medium text-accent-text underline underline-offset-4 hover:text-accent-hover active:text-accent-active focus-visible:outline-accent-focus-ring"
          >
            Скачать CSV
          </a>
        </p>
      )}
      <section aria-label="Сводка выбранного расчёта" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-3xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-text-secondary">{kpi.label}</p>
              <Icon name={kpi.icon} className={`shrink-0 ${kpi.color}`} width="18" height="18" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{number(kpi.value)}</p>
            <p className="mt-2 text-xs leading-5 text-text-secondary">{kpi.hint}</p>
          </div>
        ))}
      </section>
      <section aria-label="Рекомендации к заказу" className="rounded-[28px] border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pt-3 sm:px-6">
          <div className="flex max-w-full gap-5 overflow-x-auto" aria-label="Фильтр по статусу">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={filters.status === tab.value}
                onClick={() => changeFilters({ status: tab.value })}
                className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 pb-3 pt-2 text-sm font-medium transition-colors hover:text-accent-text active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring ${filters.status === tab.value ? 'border-accent-solid text-accent-text' : 'border-transparent text-text-secondary'}`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${filters.status === tab.value ? 'bg-accent-subtle-bg text-accent-subtle-text' : 'bg-page-bg text-text-secondary'}`}
                >
                  {orders.filter((order) => !tab.value || order.status === tab.value).length}
                </span>
              </button>
            ))}
          </div>
          <span className="pb-3 text-xs text-text-secondary">
            Расчёт от {new Date(run.created_at).toLocaleDateString('ru-RU')}
          </span>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(240px,1.7fr)_1fr_1fr_1fr]">
            <label className="relative block">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3.5 top-3 text-text-muted"
                width="18"
                height="18"
              />
              <input
                aria-label="Поиск по артикулу или названию"
                value={filters.search}
                onChange={(event) => changeFilters({ search: event.target.value })}
                placeholder="Поиск по артикулу или названию"
                className={`${inputClass} w-full !pl-10`}
              />
            </label>
            <MultiSelect
              label="Поставщик"
              options={suppliers}
              values={filters.suppliers}
              onChange={(values) => changeFilters({ suppliers: values })}
            />
            <MultiSelect
              label="Категория"
              options={categories}
              values={filters.categories}
              onChange={(values) => changeFilters({ categories: values })}
            />
            <Select
              aria-label="Срочность"
              value={filters.urgency}
              onChange={(value) => changeFilters({ urgency: value })}
              options={[
                { value: '', label: 'Любая срочность' },
                ...Object.entries(urgencyLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
            <span aria-live="polite">
              Найдено <strong className="font-semibold text-text-primary">{filtered.length}</strong> из{' '}
              {orders.length} позиций{selectedRows.length > 0 && ` · Выбрано: ${selectedRows.length}`}
            </span>
            {hasFilters ? (
              <button
                type="button"
                onClick={() => changeFilters(emptyFilters)}
                className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-accent-subtle-bg active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
              >
                Сбросить фильтры
              </button>
            ) : (
              <span className="flex items-center gap-1.5">
                <Icon name="info" width="14" height="14" />
                Нажмите на позицию, чтобы открыть обоснование
              </span>
            )}
          </div>
        </div>
        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border bg-accent-subtle-bg px-5 py-3 sm:px-6">
            <span className="text-sm font-medium text-accent-subtle-text">
              Выбрано позиций: {selectedRows.length}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={startApprove}
                disabled={!pendingSelected.length || invalidSelected || mutation.isPending}
              >
                <Icon name="check" />
                Утвердить{pendingSelected.length > 0 && ` · ${pendingSelected.length}`}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportRows(selectedRows)}
                disabled={exporting || mutation.isPending}
              >
                <Icon name="download" />
                CSV
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())} aria-label="Снять выделение">
                <Icon name="close" />
              </Button>
            </div>
            {invalidSelected && (
              <p className="w-full text-xs text-text-secondary" role="alert">
                Исправьте количество в выбранных строках: целое число от 1 до 1 000 000.
              </p>
            )}
          </div>
        )}
        {!filtered.length ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="mb-5 rounded-3xl bg-page-bg p-5 text-accent-text">
              <Icon name="search" width="32" height="32" />
            </span>
            <h2 className="text-lg font-semibold">
              {orders.length ? 'Нет рекомендаций по выбранным фильтрам' : 'Нет рекомендаций в этом расчёте'}
            </h2>
            <p className="mb-5 mt-2 max-w-md text-sm leading-6 text-text-secondary">
              {orders.length
                ? 'Попробуйте другое название, артикул или измените условия поиска.'
                : 'Выберите другой расчёт в верхней панели.'}
            </p>
            {hasFilters && (
              <Button variant="secondary" onClick={() => changeFilters(emptyFilters)}>
                Сбросить фильтры
              </Button>
            )}
          </div>
        ) : (
          <>
            <OrdersTable
              rows={pageRows}
              filtered={filtered}
              suppliers={suppliers}
              categoryNames={categoryNames}
              selected={selected}
              sort={sort}
              draft={draft}
              onDraft={(id, value) => setDrafts((previous) => ({ ...previous, [id]: value }))}
              onSort={changeSort}
              onSelect={toggleRows}
              onOpen={setActiveId}
            />
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-xs text-text-secondary sm:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Показано {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, filtered.length)} из {filtered.length}
                </span>
                <Select
                  aria-label="Позиций на странице"
                  value={String(pageSize)}
                  onChange={(value) => {
                    setPageSize(Number(value));
                    setPage(1);
                  }}
                  options={[10, 20, 50].map((value) => ({ value: String(value), label: `По ${value}` }))}
                  className="!min-h-9 !rounded-xl !py-1 !text-xs"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  className="!min-h-9 !rounded-xl !px-2 !py-1"
                  aria-label="Предыдущая страница"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <Icon name="chevron" className="rotate-180" width="16" height="16" />
                </Button>
                <span aria-live="polite">
                  {currentPage} / {pages}
                </span>
                <Button
                  variant="secondary"
                  className="!min-h-9 !rounded-xl !px-2 !py-1"
                  aria-label="Следующая страница"
                  disabled={currentPage === pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <Icon name="chevron" width="16" height="16" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="flex items-start gap-2 px-1 text-xs leading-5 text-text-secondary">
        <Icon name="info" width="16" height="16" className="mt-0.5 shrink-0" />
        <span>
          Рекомендации требуют вашего подтверждения. Заказы не отправляются поставщикам автоматически.
          {USE_MOCK && ' Изменения в деморежиме сохраняются до перезагрузки страницы.'}
        </span>
      </p>
      {notice && (
        <div
          role={notice.error ? 'alert' : 'status'}
          className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg sm:max-w-md"
        >
          <Icon
            name={notice.error ? 'warning' : 'check'}
            className={`mt-0.5 shrink-0 ${notice.error ? 'text-status-critical' : 'text-status-good'}`}
          />
          <p className="text-sm leading-5">{notice.text}</p>
          <button
            aria-label="Закрыть уведомление"
            type="button"
            className="rounded-md p-1 text-text-secondary hover:bg-page-bg focus-visible:outline-accent-focus-ring"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" width="16" height="16" />
          </button>
        </div>
      )}
      {activeOrder && (
        <OrderDetailDrawer
          key={activeOrder.id}
          order={activeOrder}
          initialQuantity={draft(activeOrder)}
          busy={mutation.isPending}
          error={notice?.error ? notice.text : undefined}
          onClose={() => setActiveId(null)}
          onDecide={(order, quantity, status, comment) =>
            mutation.mutate([{ order, quantity, status, comment }])
          }
        />
      )}
      {confirm && (
        <Dialog
          labelledBy="approve-title"
          onClose={() => {
            if (!mutation.isPending) setConfirm(null);
          }}
        >
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-subtle-bg text-accent-text">
            <Icon name="check" width="24" height="24" />
          </div>
          <h2 id="approve-title" className="text-xl font-semibold">
            Утвердить выбранные позиции?
          </h2>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Позиций: <strong className="text-text-primary">{confirm.length}</strong>. Количество:{' '}
            {Object.entries(
              confirm.reduce<Record<string, number>>(
                (totals, item) => ({
                  ...totals,
                  [item.order.unit]: (totals[item.order.unit] ?? 0) + item.quantity,
                }),
                {},
              ),
            )
              .map(([unit, quantity]) => `${number(quantity)} ${unit}`)
              .join(', ')}
          </p>
          <p className="mt-4 rounded-2xl bg-page-bg p-4 text-sm leading-6">
            Утверждение не отправляет заказ поставщику автоматически.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button onClick={() => mutation.mutate(confirm)} disabled={mutation.isPending}>
              {mutation.isPending ? 'Сохраняем…' : 'Утвердить'}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
