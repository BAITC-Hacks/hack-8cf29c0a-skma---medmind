import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../shared/theme/ThemeContext';
import { useCalcRun } from '../shared/calc-run/useCalcRun';
import { Button } from '../shared/ui/Button';
import { Icon, type IconName } from '../shared/ui/Icon';
import { Select } from '../shared/ui/Select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startCalculation } from '../shared/api/settings';
import type { CalcRun } from '../shared/api/types';

const NAV_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/dashboard', label: 'Дашборд', icon: 'dashboard' },
  { to: '/assistant', label: 'AI Ассистент', icon: 'chat' },
  { to: '/products', label: 'Товары', icon: 'dashboard' },
  { to: '/orders', label: 'Заказы', icon: 'orders' },
  { to: '/sales', label: 'История продаж', icon: 'history' },
  { to: '/settings', label: 'Настройки', icon: 'settings' },
];
const STATUS_LABEL: Record<string, string> = { running: 'выполняется', done: 'готов', failed: 'ошибка' };

function Sidebar({ onClose }: { onClose?: () => void }) {
  return (
    <aside className={onClose ? 'flex min-h-full flex-col bg-surface p-4' : 'hidden shrink-0 flex-col rounded-3xl border border-border bg-surface p-5 lg:flex lg:w-64'}>
      {onClose && <Button variant="ghost" onClick={onClose} aria-label="Закрыть меню" className="self-end px-3"><Icon name="close" /></Button>}
      <div className="flex items-center gap-3 px-2 py-3 lg:mb-10">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-subtle-bg text-accent-text"><Icon name="spark" width="25" height="25" /></span>
        <div><div className="text-lg font-bold tracking-tight">HackAlem <span className="text-accent-text">AI</span></div><p className="text-xs text-text-secondary">Управление закупками</p></div>
      </div>
      <p className="mb-3 px-3 text-xs font-medium tracking-widest text-text-secondary">РАБОЧЕЕ ПРОСТРАНСТВО</p>
      <nav aria-label="Основная навигация" className="flex flex-col gap-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex min-h-12 min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring active:bg-page-bg ${isActive ? 'bg-accent-subtle-bg text-accent-subtle-text' : 'text-text-secondary hover:bg-page-bg hover:text-accent-text'}`}>
            <Icon name={item.icon} className="shrink-0" /><span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto hidden pt-12 lg:block">
        <div className="rounded-2xl bg-page-bg p-4"><Icon name="spark" className="mb-3 text-accent-text" /><p className="text-sm font-semibold">Решения на основе данных</p><p className="mt-2 text-xs leading-5 text-text-secondary">От прогноза спроса до обоснованного заказа поставщику.</p></div>
        <p className="px-3 pt-5 text-xs text-text-secondary">HackAlem AI · Рабочее пространство</p>
      </div>
    </aside>
  );
}

function Header({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { runs, selectedRunId, setSelectedRunId, isLoading, isError, retry } = useCalcRun();
  const cache = useQueryClient();
  const calculation = useMutation({ mutationFn: startCalculation, onSuccess: run => {
    cache.setQueryData<CalcRun[]>(['calc-runs'], previous => [run, ...(previous ?? []).filter(item => item.id !== run.id)]);
    setSelectedRunId(run.id);
  } });
  const running = runs.some(run => run.status === 'running');
  const options = runs.map((run) => ({ value: run.id, label: `${new Date(run.created_at).toLocaleDateString('ru-RU')} · ${STATUS_LABEL[run.status] ?? run.status}` }));
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-1 pb-6 pt-2">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onOpenMenu} aria-label="Открыть меню" aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-haspopup="dialog" className="shrink-0 px-3 lg:hidden"><Icon name="menu" /></Button>
        <div><p className="mb-1 text-xs text-text-secondary">Компания</p><p className="text-sm font-semibold">ТОО «Электрокомплект»</p></div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto">
        {pathname === '/sales' ? <span className="mr-auto flex items-center gap-2 text-sm text-text-secondary"><Icon name="history" />Журнал операций</span> : <>
          {isLoading ? <span className="text-sm text-text-secondary" role="status">Загрузка расчётов…</span> : options.length === 0 ? <span className="text-sm text-text-secondary">Нет доступных расчётов</span> : <Select aria-label="Выбор прогона расчёта" options={options} value={selectedRunId} onChange={setSelectedRunId} className="flex-1 sm:flex-none" />}
          <Button variant="primary" disabled={isLoading || isError || running || calculation.isPending} onClick={() => calculation.mutate()}><Icon name="spark" />{calculation.isPending ? 'Запуск…' : running ? 'Расчёт выполняется…' : 'Пересчитать'}</Button>
        </>}
        <button type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface text-text-secondary transition-colors hover:bg-accent-subtle-bg hover:text-accent-text active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
        <div aria-label="Компания Электрокомплект" className="hidden h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-text-secondary sm:flex">ЭК</div>
      </div>
      {isError && <div role="alert" className="flex w-full items-center gap-3 text-sm"><p>Не удалось загрузить расчёты.</p><Button variant="secondary" onClick={retry}>Повторить</Button></div>}
      {calculation.isError && <p role="alert" className="w-full text-sm">{calculation.error.message}</p>}
      {runs.find(run => run.id === selectedRunId)?.status === 'failed' && <p role="alert" className="w-full text-sm">Расчёт завершился с ошибкой. Повторите запуск или обратитесь к администратору.</p>}
    </header>
  );
}

export function Layout() {
  const [menuLocation, setMenuLocation] = useState<string | null>(null);
  const menuRef = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const menuOpen = menuLocation === location.key;
  const setMenuOpen = (open: boolean) => setMenuLocation(open ? location.key : null);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuLocation(null); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const dialog = menuRef.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [menuOpen]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-5 bg-page-bg p-3 sm:p-5 lg:h-screen lg:flex-row lg:gap-8 lg:p-6">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-8 focus:top-8 focus:z-50 focus:rounded-xl focus:bg-surface focus:p-4 focus:text-accent-text">Перейти к содержимому</a>
      <Sidebar />
      <dialog
        ref={menuRef}
        id="mobile-navigation"
        aria-label="Меню навигации"
        onCancel={(event) => { event.preventDefault(); setMenuOpen(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}
        className="m-0 h-dvh max-h-dvh w-80 max-w-[calc(100%-2rem)] overflow-y-auto overscroll-contain rounded-r-3xl border border-border bg-surface p-0 text-text-primary backdrop:bg-page-bg backdrop:opacity-75"
      >
        {menuOpen && <Sidebar onClose={() => setMenuOpen(false)} />}
      </dialog>
      <div className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto lg:pr-2">
        <Header onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main id="main-content" tabIndex={-1} className="flex-1 py-8 outline-none sm:py-10"><Outlet /></main>
      </div>
    </div>
  );
}
