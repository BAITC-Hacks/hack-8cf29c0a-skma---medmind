# HackAlem AI — frontend

## Экран «История продаж»

Маршрут `/sales`, пункт «История продаж» в меню. Работает только на frontend:
90 синтетических операций за 25.08–23.09.2026, без запросов к API продаж.
Данные не зависят от прогона расчёта заказов. Доступны даты, поиск по товару,
обоим артикулам и документу, фильтры поставщика/категории/типа операции,
сортировка, пагинация, детали документа и CSV всего отфильтрованного списка.
Выручка и график учитывают возвраты со знаком минус; оптовые отгрузки входят
в итог. Их метки заданы в тестовых данных, это не автоматическая детекция аномалий.
Фильтры сбрасываются при уходе со страницы или перезагрузке.

## Запуск и экран «Заказы»

Запуск (Node.js 22.18+):

```sh
npm ci
npm run dev
```

Откройте `/orders`. Деморежим включён по умолчанию (`VITE_USE_MOCK=true`);
сервер для него не требуется. JSON-фикстура `src/shared/api/fixtures/orders.json`
содержит 20 вымышленных товарных позиций IEK и Systeme Electric, четыре категории,
три уровня срочности и три статуса. Это демонстрационные данные, не реальные
рекомендации к закупке. Детерминированная формула в `features/orders/mock.ts`
нужна для согласованных значений в таблице и обосновании и не заменяет прогнозную модель.

Доступны поиск по названию/обоим артикулам, совместные фильтры, сортировка внутри
поставщика, сворачивание групп и пагинация. Статус фильтруется вкладками.
Количество можно отредактировать в строке перед массовым утверждением или
в панели обоснования; подтверждение не отправляет заказ поставщику.
Панель показывает факторы расчёта, остатки, исключённые отгрузки и комментарий.

Переключение расчёта меняет значения и статусы. У неуспешного расчёта от 02.09.2026
показано отдельное состояние ошибки. Решения сохраняются при переходах между
страницами и расчётами в текущей сессии, а перезагрузка восстанавливает фикстуры.
CSV экспортирует выбранные строки либо весь отфильтрованный список, включая
фактически утверждённые количества; несогласованные черновики не выдаются за
утверждённые. Кодировка UTF-8 с BOM, разделитель `;`, формулы в текстовых полях
экранируются. После подготовки остаётся ссылка повторного скачивания.

При `VITE_USE_MOCK=false` чтение, утверждение и CSV-экспорт используют API из
`VITE_API_BASE_URL` (по умолчанию `/api`). Отклонение пока реализовано только
в деморежиме: серверный контракт для него ещё не определён. Excel/PDF не реализованы.

Проверки:

```sh
npm test
npm run build
npm run lint
```

Тесты проверяют совместную фильтрацию, сортировку, ограничения количества,
согласованность обоснований во всех расчётах и CSV. Используется встроенный
Node.js test runner, дополнительных зависимостей для тестирования нет.

---

## Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
