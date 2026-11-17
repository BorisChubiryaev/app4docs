import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { categories, tools } from '../data/tools';
import { handleUrlExcelDownload, hasUrlDownloadData } from '../utils/urlExcelDownloader';
import DownloadSuccessModal from '../components/DownloadSuccessModal';

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [filename, setFilename] = useState('');
  const category = params.get('category') || categories[0];
  const filtered = tools.filter(tool => (category === categories[0] || tool.category === category) && `${tool.title} ${tool.description} ${tool.format}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  useEffect(() => {
    if (hasUrlDownloadData()) void handleUrlExcelDownload({ onSuccess: setFilename, onError: error => console.error('URL download error:', error) });
  }, []);
  return <main className="tool-home">
    <section className="home-intro"><div className="eyebrow"><span /> ВАШ ЕЖЕДНЕВНЫЙ НАБОР ИНСТРУМЕНТОВ</div><h1>Меньше рутины.<br /><span>Больше сделанного.</span></h1><p>Документы, таблицы и презентации — всё, что нужно<br /> для работы с файлами, в одном пространстве.</p><div className="intro-facts"><span>✓ Без установки</span><span>✓ Без загрузки файлов на сервер</span></div><div className="intro-art" aria-hidden="true"><div className="art-sheet art-sheet-back">XLS<span>▦</span></div><div className="art-sheet">PDF<span>≡</span><i /><i /><i /></div><span className="art-spark">✳</span></div></section>
    <section aria-labelledby="quick-title"><div className="section-heading"><h2 id="quick-title">Быстрый старт</h2><span>Частые задачи — в один клик</span></div><div className="quick-grid">{[tools[2], tools[1], tools[9]].map(tool => <Link key={tool.path} to={tool.path}><span>{tool.symbol}</span><div><strong>{tool.title}</strong><small>{tool.format}</small></div><b>↗</b></Link>)}</div></section>
    <section aria-labelledby="catalog-title"><div className="section-heading catalog-heading"><div><h2 id="catalog-title">Инструмент для каждой задачи</h2><p>Выберите, с чем хотите поработать</p></div><label className="tool-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Найти инструмент…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Поиск инструментов" /></label></div><div className="category-tabs" aria-label="Категории инструментов">{categories.map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'selected' : ''} onClick={() => setParams(item === categories[0] ? {} : { category: item })}>{item}{item === categories[0] && <span>{tools.length}</span>}</button>)}</div><p className="result-count" aria-live="polite">Найдено инструментов: {filtered.length}</p><div className="tool-grid">{filtered.map(tool => <Link className="tool-card" key={tool.path} to={tool.path}><div className="tool-card-top"><span className={`tool-symbol tone-${categories.indexOf(tool.category)}`} aria-hidden="true">{tool.symbol}</span><span className="card-arrow" aria-hidden="true">↗</span></div><h3>{tool.title}</h3><p>{tool.description}</p><div className="tool-card-bottom"><span>{tool.format}</span><span>{tool.category}</span></div></Link>)}</div>{!filtered.length && <div className="empty-search"><h3>Такого инструмента пока нет</h3><p>Попробуйте другое название или выберите все категории.</p><button onClick={() => { setQuery(''); setParams({}); }}>Сбросить поиск</button></div>}</section>
    <footer className="home-footer"><span>convertix. <span>Сложные задачи. Простые инструменты.</span></span><div><a href="https://public.oprosso.sber.ru/p/jgwgns80" target="_blank" rel="noreferrer">Поделиться мнением ↗</a><a href="https://sberchat.sberbank.ru/join-circle/0abb2491520a72356261de83e7ba96bbace14faae1248dedd3125ed476f5295b" target="_blank" rel="noreferrer">Сообщество ↗</a></div></footer>
    <DownloadSuccessModal isOpen={!!filename} onClose={() => setFilename('')} filename={filename} />
  </main>;
}
