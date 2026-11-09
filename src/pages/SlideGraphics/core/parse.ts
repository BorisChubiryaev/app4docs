// Число из ячейки: «1 240», «12,4», «18 %», «−3» → number
export const parseNum = (s: string) => {
  const v = parseFloat(s.replace(/[\s\u00a0\u202f]/g, "").replace(/[^\d,.\-−]/g, "").replace("−", "-").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
