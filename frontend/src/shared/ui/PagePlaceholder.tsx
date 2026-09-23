import { Icon, type IconName } from './Icon';

interface PagePlaceholderProps { title: string; }
const CONTENT: Record<string, { icon: IconName; description: string; features: { title: string; text: string }[] }> = {
  'Заказы': { icon: 'orders', description: 'Рекомендации по закупкам и всё необходимое для работы с поставщиками.', features: [
    { title: 'Рекомендации к заказу', text: 'Позиции, количество и приоритет закупки в едином списке.' },
    { title: 'Прозрачный расчёт', text: 'Обоснование каждой рекомендации с учётом спроса и остатков.' },
    { title: 'Согласование и экспорт', text: 'Корректировка количества и подготовка заказов поставщикам.' },
  ] },
  'Дашборд': { icon: 'dashboard', description: 'Ключевые показатели закупок, динамика спроса и риски дефицита.', features: [
    { title: 'Главное в цифрах', text: 'Общая картина по позициям, поставщикам и срочным закупкам.' },
    { title: 'Прогноз спроса', text: 'Сравнение фактических продаж и прогнозируемой потребности.' },
    { title: 'Риски дефицита', text: 'Позиции, на которые нужно обратить внимание в первую очередь.' },
  ] },
  'Настройки': { icon: 'settings', description: 'Параметры прогнозирования и правила закупок для вашей компании.', features: [
    { title: 'Параметры прогноза', text: 'Горизонт планирования и чувствительность к колебаниям спроса.' },
    { title: 'Правила поставщиков', text: 'Минимальные партии, кратность заказа и сроки поставки.' },
    { title: 'Буфер безопасности', text: 'Настройка запаса для устойчивой работы с ассортиментом.' },
  ] },
};

export function PagePlaceholder({ title }: PagePlaceholderProps) {
  const content = CONTENT[title];
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-3 text-xs font-medium tracking-widest text-text-secondary">УПРАВЛЕНИЕ ЗАКУПКАМИ</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">{content.description}</p></div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs font-medium text-text-secondary"><Icon name="clock" width="15" height="15" />В разработке</span>
      </div>
      <section aria-labelledby="empty-title" className="overflow-hidden rounded-[28px] border border-border bg-surface">
        <div className="flex min-h-[340px] flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-page-bg text-accent-text"><Icon name={content.icon} width="36" height="36" /></div>
          <p className="mb-3 text-xs font-medium tracking-widest text-text-secondary">СКОРО В ВАШЕМ ПРОСТРАНСТВЕ</p>
          <h2 id="empty-title" className="text-xl font-semibold tracking-tight sm:text-2xl">Готовим раздел «{title}»</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-text-secondary">Здесь появятся инструменты для вашей ежедневной работы. Раздел пока недоступен — мы работаем над его запуском.</p>
        </div>
        <div className="border-t border-border px-6 py-4 text-xs text-text-secondary sm:px-8">Что появится в этом разделе</div>
        <div className="grid gap-4 px-6 pb-6 sm:px-8 sm:pb-8 xl:grid-cols-3">
          {content.features.map((feature, index) => <div key={feature.title} className="rounded-2xl bg-page-bg p-5"><span className="mb-4 block text-xs font-medium text-text-secondary">0{index + 1}</span><h3 className="text-sm font-semibold">{feature.title}</h3><p className="mt-2 text-sm leading-6 text-text-secondary">{feature.text}</p></div>)}
        </div>
      </section>
    </div>
  );
}
