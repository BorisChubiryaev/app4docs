// Быстрый поиск инструментов (Ctrl+K): открыть из любого места
export const OPEN_PALETTE = "cvx:palette";
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE));
export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
