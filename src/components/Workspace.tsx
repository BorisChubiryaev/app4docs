import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { tools } from '../data/tools';
import ThemeToggle from './ThemeToggle';

export default function Workspace({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const current = tools.find(tool => tool.path === pathname);
  return <div className="workspace">
    <a className="skip-link" href="#workspace-content">Перейти к содержимому</a>
    <aside className={`workspace-sidebar${open ? ' is-open' : ''}`}>
      <Link className="workspace-brand" to="/" onClick={() => setOpen(false)}><span className="brand-mark">c↗</span>convertix<span className="brand-dot">.</span></Link>
      <p className="sidebar-label">РАБОЧЕЕ ПРОСТРАНСТВО</p>
      <nav aria-label="Основная навигация" onClick={() => setOpen(false)}>
        <Link className={`sidebar-link${pathname === '/' ? ' active' : ''}`} to="/" aria-current={pathname === '/' ? 'page' : undefined}><span>▦</span>Все инструменты</Link>
        <p className="sidebar-label">ИНСТРУМЕНТЫ</p>
        {tools.filter(tool => tool.category !== 'Игры').map(tool => <Link key={tool.path} to={tool.path} className={`sidebar-link${pathname === tool.path ? ' active' : ''}`} aria-current={pathname === tool.path ? 'page' : undefined}><span aria-hidden="true">{tool.symbol}</span>{tool.title}</Link>)}
        <Link className="sidebar-link" to="/?category=Игры"><span>♞</span>Перерыв и игры</Link>
      </nav>
      <div className="sidebar-note"><strong>◉ Файлы остаются у вас</strong><p>Обработка в браузере.<br />Без отправки на сервер.</p></div>
    </aside>
    {open && <button className="sidebar-backdrop" aria-label="Закрыть навигацию" onClick={() => setOpen(false)} />}
    <div className="workspace-main">
      <header className="workspace-topbar"><div><button className="mobile-menu" aria-label={open ? 'Закрыть навигацию' : 'Открыть навигацию'} aria-expanded={open} onClick={() => setOpen(value => !value)}>☰</button><Link to="/">Рабочее пространство</Link><span className="breadcrumb-separator">/</span><strong>{current?.title || 'Все инструменты'}</strong></div><ThemeToggle /></header>
      <div id="workspace-content" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}
