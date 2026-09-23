# AGENTS.md — правила для агента (Codex)

Правила ниже обязательны для любого агента, генерирующего или редактирующего UI-код в этом репозитории. Источник истины по цвету и экранам — [DESIGN.md](./DESIGN.md). Этот файл — исполняемая выжимка из него: если код противоречит `AGENTS.md`, это баг, который нужно исправить до коммита.

---

## 1. Главное правило

**Цвет в этом проекте не подбирается на глаз.** Каждый hex в `DESIGN.md` посчитан в OKLCH и проверен скриптом на WCAG-контраст и CVD-безопасность (для дальтоников). Задача агента — **использовать токены**, а не изобретать новые цвета и не«улучшать» существующие интуитивно.

Если нужного оттенка нет в токенах (раздел 2) — это повод спросить пользователя или расширить палитру тем же методом (dataviz-скилл, `validate_palette.js`), а не вписать произвольный hex.

---

## 2. Источник токенов (копировать как есть)

Все цвета живут в CSS custom properties, Tailwind обращается к ним по имени роли. Ничего не хардкодить в классах напрямую.

`src/styles/tokens.css`:

```css
:root {
  color-scheme: light;
  --page-bg:            #f6fbfe;
  --surface:            #fbfeff;
  --border:             #d7e0e5;
  --text-primary:       #0b1317;
  --text-secondary:     #45555e;
  --text-muted:         #7b8990;

  --accent-solid:       #2c7294;
  --accent-hover:       #01678e;
  --accent-active:      #00597d;
  --accent-text:        #2c7294;
  --accent-subtle-bg:   #cff1ff;
  --accent-subtle-text: #01678e;
  --accent-focus-ring:  #2c7294;

  --status-good:        #0ca30c;
  --status-warning:     #fab219;
  --status-serious:     #ec835a;
  --status-critical:    #d03b3b;
}

@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page-bg:            #090e11;
    --surface:            #151b1f;
    --border:             #272f34;
    --text-primary:       #f6f9fa;
    --text-secondary:     #b5bfc5;
    --text-muted:         #768289;

    --accent-solid:       #1477a0;
    --accent-hover:       #2686b1;
    --accent-active:      #01678e;
    --accent-text:        #50a6d2;
    --accent-subtle-bg:   #003c57;
    --accent-subtle-text: #cff1ff;
    --accent-focus-ring:  #3995c1;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page-bg:            #090e11;
  --surface:            #151b1f;
  --border:             #272f34;
  --text-primary:       #f6f9fa;
  --text-secondary:     #b5bfc5;
  --text-muted:         #768289;

  --accent-solid:       #1477a0;
  --accent-hover:       #2686b1;
  --accent-active:      #01678e;
  --accent-text:        #50a6d2;
  --accent-subtle-bg:   #003c57;
  --accent-subtle-text: #cff1ff;
  --accent-focus-ring:  #3995c1;
}
```

`--status-*` не переопределяются в dark-блоке — статусные цвета фиксированные (см. правило 4).

`tailwind.config.js` (фрагмент):

```js
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'page-bg':            'var(--page-bg)',
        surface:               'var(--surface)',
        border:                 'var(--border)',
        'text-primary':        'var(--text-primary)',
        'text-secondary':      'var(--text-secondary)',
        'text-muted':          'var(--text-muted)',
        'accent-solid':        'var(--accent-solid)',
        'accent-hover':        'var(--accent-hover)',
        'accent-active':       'var(--accent-active)',
        'accent-text':         'var(--accent-text)',
        'accent-subtle-bg':    'var(--accent-subtle-bg)',
        'accent-subtle-text':  'var(--accent-subtle-text)',
        'accent-focus-ring':   'var(--accent-focus-ring)',
        'status-good':         'var(--status-good)',
        'status-warning':      'var(--status-warning)',
        'status-serious':      'var(--status-serious)',
        'status-critical':     'var(--status-critical)',
      },
    },
  },
};
```

После этого в компонентах пишется `bg-accent-solid hover:bg-accent-hover active:bg-accent-active`, а не `bg-[#2c7294]`.

Категориальная палитра графиков и sequential-рамп (раздел 2.4–2.5 `DESIGN.md`) заводятся точно так же, отдельными переменными `--chart-series-1`…`--chart-series-8`, при первом графике в проекте — не раньше.

---

## 3. Жёсткие запреты

- **Никаких произвольных hex/rgb в JSX/CSS/Tailwind-классах** (`bg-[#...]`, `style={{color: '#...'}}`) кроме самого файла `tokens.css`. Любой найденный произвольный цвет — это находка для ревью, а не «мелочь».
- **Никакого автоматического «затемнения» цвета через CSS-фильтры** (`filter: brightness()`, `opacity` для имитации hover/dark) вместо явного токена состояния — контраст для этого не считался.
- **Не смешивать светлую и тёмную тему на одном экране.** Тема выбирается на уровне `<html data-theme>`, компонент не переопределяет тему сам.
- **Не использовать статусные цвета (`status-*`) для идентичности ряда/категории** и наоборот — категориальные оттенки графика не переиспользуются как индикатор состояния.
- **Не красить текст в цвет серии графика.** Текст — всегда `text-primary/secondary/muted`; цвет несёт маркер/точка/бейдж рядом с текстом.

---

## 4. Обязательные правила состояний и семантики

- Кнопка `primary` = `accent-solid` / `hover:accent-hover` / `active:accent-active`; текст на кнопке — белый (`#fff`) в обеих темах (контраст выше 4.5:1 уже проверен, менять цвет текста кнопки не нужно).
- Срочность заказа: `high → status-critical`, `medium → status-warning`, `low → status-good`. Каждый бейдж — иконка + подпись, не только заливка цветом.
- Статус заказа: `pending` — нейтральный бейдж (`border` + `text-secondary`), НЕ статусный цвет; `approved → status-good`; `rejected → status-critical`.
- Три светлых слота графика (aqua/yellow/magenta, см. `DESIGN.md` §2.4) имеют контраст < 3:1 в светлой теме — обязательны видимые прямые подписи значений или таблица рядом, полагаться только на цвет нельзя.

---

## 5. Чек-лист перед коммитом UI-кода

- [ ] Все цвета взяты из `tokens.css`/Tailwind-токенов, ни одного сырого hex вне `tokens.css`
- [ ] Тёмная тема проверена — не просто инвертирована, а через `data-theme="dark"` / `prefers-color-scheme`
- [ ] Кнопки/ссылки используют состояния `hover`/`active`/`focus-ring` из токенов, а не самодельные
- [ ] Срочность/статус используют строго маппинг из раздела 4, не другие цвета
- [ ] На графике с ≥2 рядами есть легенда; ряды с контрастом < 3:1 сопровождены подписями или таблицей
- [ ] Ни один новый цвет не добавлен без прогона `validate_palette.js` (dataviz-скилл) — см. `DESIGN.md` §2.6

Если чек-лист не проходит — это блокер для PR, не «доработать потом».
