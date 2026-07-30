export function formatNumber(
  value: number | any,
  decimals: number = 2,
): string {
  if (typeof value !== "number" || !isFinite(value)) return String(value ?? "");
  const hasDecimals = value % 1 !== 0;
  const fixed = hasDecimals ? value.toFixed(decimals) : value.toFixed(0);
  const parts = fixed.split(".");
  const formatted = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return parts[1] ? `${formatted}.${parts[1]}` : formatted;
}

export function formatAxisValue(value: number): string {
  if (typeof value !== "number" || !isFinite(value)) return "";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000)
    return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}${formatNumber(abs, 0)}`;
  if (abs % 1 !== 0) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs}`;
}
