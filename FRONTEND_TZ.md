# Техническое задание: Frontend
## HackAlem AI — Автоматизация формирования заказов поставщикам

Разбивка на 2 разработчиков для параллельной работы. Базируется на [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 0. Общая часть (обязательна к прочтению обоими разработчиками)

### 0.1 Стек (минимум зависимостей, современный вид)

Осознанно выбран **Lean React**, а не полный enterprise-набор — бэкенд на Python, фронт должен оставаться маленьким и лёгким в поддержке.

- **Vite** + React 18 + TypeScript — сборка, без CRA/Next.js (не нужен SSR)
- **Роутинг**: React Router (единственный внешний роутер, альтернатив нет смысла тащить)
- **Состояние сервера**: TanStack Query — кэш и рефетч запросов к API, избавляет от ручного стейт-менеджмента загрузок
- **Состояние UI**: React Context + `useState`/`useReducer` — **без Zustand/Redux**, глобального состояния в приложении всего одно (выбранный `calc_run`), для этого Context достаточен
- **Стили**: Tailwind CSS + **shadcn/ui** — это не npm-зависимость в привычном смысле: компоненты (Table, Modal, Dropdown и т.д.) копируются в `shared/ui/` и дорабатываются на месте, без версии в `package.json`, за счёт этого — современный вид "из коробки" без веса дополнительной UI-библиотеки
- **Графики**: Recharts — единственная сторонняя визуальная библиотека, оправдана (ручное SVG под графики дороже)
- **Формы**: React Hook Form; **без Zod** — валидация нативными правилами RHF (`required`, `min`, `pattern`) — объём форм (calc-params, supplier-rules) не оправдывает отдельную схема-библиотеку
- **Моки на время отсутствия backend**: без MSW — простые JSON-фикстуры в `shared/api/fixtures/` + один флаг `VITE_USE_MOCK`, тонкий `fetch`-враппер переключает источник данных. Как только Python-backend поднят — просто выключить флаг, эндпоинты те же.

Итог: прямые зависимости — `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `recharts`, `react-hook-form`, `tailwindcss` (+ Vite/TS как tooling). shadcn/ui — не в списке, т.к. код компонентов живёт в репозитории.

### 0.2 Структура проекта

```
src/
  app/                # роутинг, layout, провайдеры (App.tsx, router.tsx)
  pages/
    OrdersPage/        # Dev 1
    OrderDetailDrawer/  # Dev 1
    DashboardPage/      # Dev 2
    SettingsPage/       # Dev 2
  features/
    orders/             # Dev 1 — логика таблицы заказов, фильтров, approve
    explainability/      # Dev 1 — карточка обоснования
    analytics/           # Dev 2 — графики, тренды
    settings/            # Dev 2 — параметры расчёта, MOQ overrides
  shared/
    api/                # общий API-клиент, типы, JSON-фикстуры — ОБЩАЯ ЗОНА
    ui/                 # общая дизайн-система (Button, Table, Badge, Modal...) — ОБЩАЯ ЗОНА
    lib/                # форматирование чисел/дат, утилиты
  types/                # общие TS-типы (из раздела 0.4) — ОБЩАЯ ЗОНА
```

**Правило:** папки `shared/` и `types/` — общая зона. Изменения в них согласовываются между разработчиками (PR-ревью друг у друга), чтобы не ломать чужой код.

### 0.3 API-контракты (общий источник правды)

Оба разработчика работают против этого контракта с первого дня, используя JSON-фикстуры (`shared/api/fixtures/`) через флаг `VITE_USE_MOCK`, пока backend не готов.

```
GET  /api/recommendations?supplier_id&category_id&urgency&run_id
     → OrderRecommendation[]

GET  /api/recommendations/:sku_code/explain?run_id
     → ExplanationDetail

POST /api/recommendations/:id/approve
     body: { approved_qty: number, comment?: string }
     → OrderRecommendation

POST /api/recommendations/export
     body: { ids: string[], format: 'csv' | 'xlsx' | 'pdf' }
     → { download_url: string }

GET  /api/suppliers
     → Supplier[]

GET  /api/categories
     → Category[]

GET  /api/calc-runs?limit=20
     → CalcRun[]

GET  /api/analytics/demand-trend?sku_code|category_id&from&to
     → TrendPoint[]

GET  /api/analytics/seasonality?sku_code|category_id
     → SeasonalityPoint[]

GET  /api/settings/calc-params
     → CalcParams

PUT  /api/settings/calc-params
     body: CalcParams
     → CalcParams

GET  /api/settings/supplier-rules?supplier_id
     → SupplierRule[]

PUT  /api/settings/supplier-rules/:id
     body: Partial<SupplierRule>
     → SupplierRule
```

### 0.4 Общие TypeScript-типы

```typescript
type Urgency = 'high' | 'medium' | 'low';

interface OrderRecommendation {
  id: string;
  run_id: string;
  sku_code: string;           // Код 1С
  supplier_sku: string;       // Артикул поставщика
  name: string;
  supplier_id: string;
  supplier_name: string;
  category_id: string;
  recommended_qty: number;
  approved_qty: number | null;
  unit: string;
  urgency: Urgency;
  status: 'pending' | 'approved' | 'rejected';
  short_reason: string;       // краткое текстовое обоснование
}

interface ExplanationDetail {
  sku_code: string;
  base_demand: number;
  seasonality_factor: number;
  growth_factor: number;
  stockout_compensation: number;
  current_stock: number;
  reserved_stock: number;
  free_stock: number;
  goods_in_transit: number;
  safety_buffer: number;
  bulk_outliers_excluded: { date: string; qty: number; document: string }[];
  final_qty: number;
  narrative: string;          // человекочитаемое обоснование
}

interface Supplier {
  id: string;
  name: string;
  lead_time_days: number;
}

interface Category {
  id: string;
  name: string;
}

interface CalcRun {
  id: string;
  created_at: string;
  horizon_days: number;
  status: 'running' | 'done' | 'failed';
}

interface TrendPoint {
  period: string;   // YYYY-MM
  actual_qty: number;
  forecast_qty?: number;
}

interface SeasonalityPoint {
  month: number;     // 1-12
  factor: number;
}

interface CalcParams {
  forecast_horizon_days: number;
  safety_buffer_days: number;
  outlier_sensitivity: number; // 0-1
}

interface SupplierRule {
  id: string;
  supplier_id: string;
  sku_code: string;
  min_order_qty: number;
  order_multiple: number;
}
```

### 0.5 Definition of Done (для обоих)
- Все страницы работают на JSON-фикстурах (`VITE_USE_MOCK=true`), без обращения к реальному backend
- TypeScript strict mode без ошибок, без `any`
- Адаптивная вёрстка (минимум: desktop 1280px+ и планшет 1024px, мобильная адаптация не приоритет для B2B-инструмента)
- Состояния loading/empty/error отрисованы для каждого запроса к API
- Комментарии в PR по изменениям в `shared/`

---

## Разработчик 1 (Codex-1): Core — таблица рекомендаций и explainability

### Задача
Реализовать основной рабочий экран менеджера закупок: список рекомендованных заказов, фильтрация/группировка, карточка обоснования, процесс утверждения, экспорт.

### 1.1 OrdersPage — таблица рекомендаций
- Таблица с колонками: Артикул (код 1С + артикул поставщика), Наименование, Поставщик, Категория, Рекомендуемое кол-во, Утверждённое кол-во (editable), Срочность (badge: high/medium/low), Статус, действия.
- Сортировка по любой колонке.
- Фильтры: поставщик (multi-select), категория (multi-select), срочность, статус.
- **Группировка по поставщику** (обязательно по ТЗ) — сворачиваемые секции таблицы, с подытогом количества строк на поставщика.
- Пагинация или виртуализация (список может быть большим — тысячи SKU, см. `react-virtual` при >500 строк).
- Чекбоксы для мультивыбора строк → массовые действия (approve/export выбранных).
- Пустое состояние и состояние загрузки.

### 1.2 OrderDetailDrawer — карточка обоснования (explainability)
Открывается по клику на строку. Показывает `ExplanationDetail`:
- Разбивка факторов: базовый спрос, коэффициент сезонности, коэффициент роста, компенсация stockout, буфер — в виде понятной визуальной раскладки (не просто JSON), например список "фактор → значение → вклад".
- Текущий остаток / зарезервировано / свободный остаток / товар в пути — блок с наглядными цифрами.
- Список исключённых разовых/оптовых заказов (`bulk_outliers_excluded`) с датой, объёмом, номером документа — прозрачность для пользователя, почему их не учли.
- Человекочитаемый `narrative` текст сверху (например: "Основано на среднемесячном спросе 150 шт., текущий остаток 20 шт., товары в пути 30 шт., сезонный коэффициент ×1.3").
- Поле для ручной корректировки `approved_qty` с полем комментария.
- Кнопки Approve / Reject прямо из карточки.

### 1.3 Approve-flow
- Одиночное утверждение из строки таблицы или из drawer.
- Массовое утверждение выбранных строк с диалогом подтверждения ("Вы утверждаете N позиций на сумму M единиц — заказ НЕ будет отправлен поставщику автоматически").
- **Явно показывать пользователю, что подтверждение = не автоотправка** — это ограничение из ТЗ, критично для UX и доверия пользователя.
- После approve — статус строки меняется, попадает в "утверждённые", доступна для экспорта.

### 1.4 Экспорт
- Кнопка экспорта: выбор формата (CSV / Excel / PDF), экспорт либо всех отфильтрованных, либо только выбранных строк.
- После вызова `/api/recommendations/export` — получение `download_url` и скачивание файла.

### Файлы/зона ответственности
`pages/OrdersPage/`, `pages/OrderDetailDrawer/`, `features/orders/`, `features/explainability/`

### Приёмочные критерии
- [ ] Таблица группируется по поставщику и фильтруется по 4 фильтрам одновременно
- [ ] Клик по строке открывает drawer с полной разбивкой факторов
- [ ] Список исключённых выбросов виден и понятен пользователю без JSON
- [ ] Массовое approve работает с явным предупреждением об отсутствии автоотправки
- [ ] Экспорт в 3 форматах инициирует скачивание файла

---

## Разработчик 2 (Codex-2): Shell, Dashboard и Settings

### Задача
Реализовать каркас приложения (layout, навигация), аналитический дашборд с графиками спроса/сезонности и экран настроек параметров расчёта.

### 2.1 App Shell
- Общий Layout: боковая навигация (Заказы / Дашборд / Настройки), header (название compании, текущий `calc_run`, дата последнего расчёта, кнопка "пересчитать").
- Роутинг между страницами (React Router), защищённые роуты (заглушка авторизации — простой mock-логин, без полноценного OAuth на этом этапе).
- Общая дизайн-система в `shared/ui/`: Button, Badge, Table (базовый), Modal, Dropdown/Select, DatePicker, Toast/notifications — **это блокирует Dev 1, делать в первую очередь и коммитить рано**.
- Индикатор выбранного `calc_run` (пользователь может переключаться между историческими прогонами расчёта через выпадающий список `GET /api/calc-runs`).

### 2.2 DashboardPage — аналитика
- Виджет "Тренд спроса" — линейный график `actual_qty` vs `forecast_qty` по месяцам (`/api/analytics/demand-trend`), с возможностью выбрать SKU или категорию.
- Виджет "Сезонность" — bar/radar chart коэффициентов по месяцам (`/api/analytics/seasonality`).
- Сводные KPI-плитки сверху: всего позиций к заказу, количество high-urgency позиций, число поставщиков в текущем расчёте, дата последнего расчёта.
- Виджет "Риск дефицита" (nice-to-have из ТЗ) — топ-N позиций с наивысшей срочностью, с быстрым переходом в OrdersPage с применённым фильтром.
- Использовать `dataviz`-подход: единая цветовая палитра для всех графиков, понятные подписи осей, легенды, читаемость в светлой/тёмной теме.

### 2.3 SettingsPage — параметры расчёта
- Форма `CalcParams`: горизонт прогноза (дней), размер буфера безопасности (дней), чувствительность к выбросам (0-1, слайдер) — `GET/PUT /api/settings/calc-params`.
- Таблица `SupplierRule` (MOQ/кратность/lead time) с возможностью редактирования по строке — `GET/PUT /api/settings/supplier-rules`.
- Валидация формы через правила React Hook Form (горизонт > 0, буфер >= 0 и т.д.), явные сообщения об ошибках.
- Кнопка "Запустить пересчёт" с текущими параметрами → создаёт новый `calc_run` (мок вызова).

### Файлы/зона ответственности
`app/`, `pages/DashboardPage/`, `pages/SettingsPage/`, `features/analytics/`, `features/settings/`, `shared/ui/` (владелец, но открыт для PR от Dev 1)

### Приёмочные критерии
- [ ] Layout и навигация работают, боковое меню и header общие для всех страниц
- [ ] Дашборд показывает минимум 2 графика (тренд, сезонность) и 4 KPI-плитки
- [ ] Переключение calc_run в header меняет данные на всех страницах (общий стейт)
- [ ] Настройки сохраняются через мок API и валидируются перед отправкой
- [ ] shared/ui содержит минимум 8 переиспользуемых компонентов, покрывающих нужды обоих разработчиков

---

## Границы и точки синхронизации

1. **Day 1 (обязательно до начала параллельной работы):** Dev 2 поднимает shell + минимальный набор `shared/ui` (Table, Badge, Button, Modal) и `shared/api` с JSON-фикстурами по контракту из раздела 0.3/0.4. Dev 1 не блокируется на дальнейших этапах.
2. Любое изменение в `types/` или `shared/api` — согласовать в общем чате/PR перед мержем, т.к. оба фичесета от него зависят.
3. `OrdersPage` (Dev 1) встраивается в Layout (Dev 2) через роутинг — согласовать имя роута заранее: `/orders`, `/dashboard`, `/settings`.
4. Общий `calc_run` selector в header (Dev 2) должен быть доступен как shared state (React Context-провайдер в `shared/`), которым пользуется `features/orders` (Dev 1) для фильтрации по `run_id`.

## План работ (ориентир, 2 параллельных потока)

| Этап | Dev 1 | Dev 2 |
|---|---|---|
| 1 | Ожидает shared/ui + api-фикстуры | Shell, роутинг, shared/ui, JSON-фикстуры по контракту |
| 2 | OrdersPage: таблица, фильтры, группировка | DashboardPage: графики, KPI |
| 3 | OrderDetailDrawer: explainability | SettingsPage: calc-params, supplier rules |
| 4 | Approve-flow, экспорт | Интеграция calc_run selector в shared state |
| 5 | Интеграционное тестирование обеих частей вместе, полировка UX | — |
