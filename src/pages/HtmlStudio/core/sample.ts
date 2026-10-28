// Пример страницы «как от ИИ»: отчёт с показателями, таблицей и графиком,
// который рисует скрипт из массива данных (без внешних библиотек).
export const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отчёт по продажам — III квартал</title>
<style>
  :root { --brand: #21a038; --accent: #0b6cff; --text: #1f2330; --muted: #6b7280; --card: #ffffff; --bg: #f3f6f9; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: var(--bg); color: var(--text); }
  header { background: linear-gradient(135deg, #21a038, #0b6cff); color: #fff; padding: 36px 40px; }
  header h1 { margin: 0 0 6px; font-size: 32px; }
  header p { margin: 0; opacity: .9; }
  main { max-width: 1040px; margin: -24px auto 40px; padding: 0 20px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  .kpi { background: var(--card); border-radius: 14px; padding: 18px 20px; box-shadow: 0 4px 16px rgba(20, 30, 60, .08); }
  .kpi .value { font-size: 30px; font-weight: 700; color: var(--brand); }
  .kpi .label { color: var(--muted); font-size: 14px; }
  .card { background: var(--card); border-radius: 14px; padding: 22px 24px; margin-top: 18px; box-shadow: 0 4px 16px rgba(20, 30, 60, .08); }
  h2 { margin: 0 0 14px; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f0f7f2; color: #1b7a2e; }
  .bars { display: flex; align-items: flex-end; gap: 14px; height: 200px; padding-top: 10px; }
  .bar { flex: 1; background: linear-gradient(180deg, #0b6cff, #21a038); border-radius: 8px 8px 0 0; position: relative; }
  .bar span { position: absolute; top: -22px; left: 0; right: 0; text-align: center; font-size: 13px; font-weight: 600; }
  .bar em { position: absolute; bottom: -22px; left: 0; right: 0; text-align: center; font-size: 12px; font-style: normal; color: var(--muted); }
  footer { text-align: center; color: var(--muted); font-size: 13px; margin: 40px 0 20px; }
</style>
</head>
<body>
<header>
  <h1>Отчёт по продажам — III квартал 2026</h1>
  <p>Подготовлено отделом аналитики · данные на 30 сентября</p>
</header>
<main>
  <section class="kpis">
    <div class="kpi"><div class="value">12,4 млн ₽</div><div class="label">Выручка за квартал</div></div>
    <div class="kpi"><div class="value">+18%</div><div class="label">Рост к прошлому году</div></div>
    <div class="kpi"><div class="value">1 240</div><div class="label">Новых клиентов</div></div>
    <div class="kpi"><div class="value">4,1%</div><div class="label">Отток клиентов</div></div>
  </section>

  <section class="card">
    <h2>Выручка по месяцам, млн ₽</h2>
    <div class="bars" id="chart"></div>
  </section>

  <section class="card">
    <h2>Продажи по регионам</h2>
    <table>
      <thead><tr><th>Регион</th><th>Выручка, млн ₽</th><th>План, %</th><th>Ответственный</th></tr></thead>
      <tbody>
        <tr><td>Москва</td><td>5,2</td><td>104</td><td>Иванова А.</td></tr>
        <tr><td>Санкт-Петербург</td><td>3,1</td><td>97</td><td>Петров С.</td></tr>
        <tr><td>Казань</td><td>2,0</td><td>110</td><td>Сидорова Е.</td></tr>
        <tr><td>Новосибирск</td><td>2,1</td><td>92</td><td>Кузнецов Д.</td></tr>
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Выводы</h2>
    <p>Рост выручки обеспечили цифровые каналы: их доля выросла до 62%. Отток снизился благодаря программе лояльности.</p>
    <p>В IV квартале планируем выход в два новых региона и запуск партнёрской программы.</p>
  </section>
</main>
<footer>© 2026 · Отдел аналитики</footer>
<script>
  const monthly = [
    { month: 'Июль', revenue: 3.8 },
    { month: 'Август', revenue: 4.1 },
    { month: 'Сентябрь', revenue: 4.5 }
  ];
  const max = Math.max(...monthly.map(m => m.revenue));
  document.getElementById('chart').innerHTML = monthly.map(m =>
    '<div class="bar" style="height:' + (m.revenue / max * 100) + '%"><span>' + m.revenue + '</span><em>' + m.month + '</em></div>'
  ).join('');
</script>
</body>
</html>
`;
