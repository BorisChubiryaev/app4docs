// Пример для кнопки «Попробовать на примере»: продажи по месяцам и каналам.
// Генерируется детерминированно — график всегда одинаковый.

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

export function demoTable(): string {
  const rows = [["Месяц", "Офлайн", "Онлайн", "Партнёры", "План"]];
  MONTHS.forEach((m, i) => {
    const season = 1 + 0.18 * Math.sin((i - 2) / 1.9);
    const offline = Math.round(820 * season - i * 9);
    const online = Math.round(310 + i * 46 + 30 * Math.cos(i));
    const partners = Math.round(190 + 25 * Math.sin(i * 1.3));
    rows.push([m, String(offline), String(online), String(partners), "1400"]);
  });
  return rows.map((r) => r.join("\t")).join("\n");
}
