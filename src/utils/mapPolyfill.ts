// Полифилл для новых методов Map: getOrInsert / getOrInsertComputed (TC39).
//
// pdfjs-dist 5.x вызывает Map.prototype.getOrInsertComputed внутри рендеринга
// страниц. В браузерах, где этот метод ещё не реализован, ЛЮБОЙ вызов
// page.render() падает с «getOrInsertComputed is not a function», из-за чего
// ломались конвертация PDF→Word (извлечение/снимок картинок) и рендер PDF.
// Подключаем полифилл один раз на старте приложения.

interface MapWithGetOrInsert<K, V> {
  getOrInsert?(key: K, defaultValue: V): V;
  getOrInsertComputed?(key: K, callback: (key: K) => V): V;
}

const proto = Map.prototype as Map<unknown, unknown> &
  MapWithGetOrInsert<unknown, unknown>;

if (typeof proto.getOrInsertComputed !== "function") {
  Object.defineProperty(proto, "getOrInsertComputed", {
    value: function <K, V>(this: Map<K, V>, key: K, callback: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const value = callback(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}

if (typeof proto.getOrInsert !== "function") {
  Object.defineProperty(proto, "getOrInsert", {
    value: function <K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
      if (this.has(key)) return this.get(key) as V;
      this.set(key, defaultValue);
      return defaultValue;
    },
    writable: true,
    configurable: true,
  });
}

export {};
