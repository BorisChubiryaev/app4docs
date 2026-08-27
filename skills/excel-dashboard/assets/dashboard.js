/* Рантайм дашборда: агрегация, фильтры и отрисовка SVG-графиков.
 * Ноль внешних зависимостей — файл открывается с диска, без интернета.
 * Данные лежат в window.__DASH__ = {title, subtitle, columns, rows, config}. */
(function () {
  "use strict";

  var D = window.__DASH__;
  var COLS = D.columns;
  var ROWS = D.rows;
  var CFG = D.config || {};
  var byName = {};
  COLS.forEach(function (c, i) { byName[c.name] = i; });

  var PALETTE = ["#4f7cff", "#22b8a6", "#f0883e", "#c56bf0", "#ef5d7a", "#5ac8fa",
                 "#9aa6b2", "#7bd88f", "#e8c547", "#ff8fa3", "#6c8ae4", "#3fb1c4"];

  // ── форматирование ─────────────────────────────────────────────────────────
  var nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

  function fmtNum(v, kind) {
    if (v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return "—";
    if (kind === "percent") return nf2.format(v * 100) + " %";
    if (kind === "money") return compact(v) + " ₽";
    if (kind === "compact") return compact(v);
    if (kind === "int") return nf0.format(Math.round(v));
    return Math.abs(v) >= 1000 ? nf0.format(v) : nf2.format(v);
  }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return nf2.format(v / 1e9) + " млрд";
    if (a >= 1e6) return nf2.format(v / 1e6) + " млн";
    if (a >= 1e4) return nf0.format(Math.round(v / 1e3)) + " тыс.";
    // Мелкие величины (средний балл, часы) округлять до целого нельзя:
    // «3» вместо «2,98» стирает как раз то, ради чего среднее и считали.
    return a >= 1000 ? nf0.format(v) : nf2.format(v);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ── доступ к значениям ─────────────────────────────────────────────────────
  function idx(name) {
    if (name === undefined || name === null) return -1;
    var i = byName[name];
    return i === undefined ? -1 : i;
  }
  function val(row, i) { return i < 0 ? null : row[i]; }
  function colType(name) { var i = idx(name); return i < 0 ? "string" : COLS[i].type; }
  /** Ключ категории: одинаковый и в подписи, и в фильтре, иначе клик по
   *  столбцу не совпадёт со значением фильтра. */
  function keyOf(v) {
    if (v === null || v === undefined || v === "") return "(пусто)";
    if (typeof v === "boolean") return v ? "Да" : "Нет";
    return String(v);
  }

  // ── бакетирование дат ──────────────────────────────────────────────────────
  var MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  function autoBucket(minISO, maxISO) {
    var days = (Date.parse(maxISO) - Date.parse(minISO)) / 86400000;
    if (!isFinite(days)) return "month";
    if (days <= 62) return "day";
    if (days <= 400) return "month";
    if (days <= 1200) return "quarter";
    return "year";
  }
  function bucketKey(iso, bucket) {
    if (!iso) return null;
    var s = String(iso), y = s.slice(0, 4), m = s.slice(5, 7), d = s.slice(8, 10);
    if (bucket === "year") return y;
    if (bucket === "quarter") return y + "-Q" + (Math.floor((+m - 1) / 3) + 1);
    if (bucket === "month") return y + "-" + m;
    if (bucket === "week") {
      var dt = new Date(Date.parse(s.slice(0, 10)));
      if (isNaN(dt.getTime())) return null;
      var day = (dt.getUTCDay() + 6) % 7;
      dt.setUTCDate(dt.getUTCDate() - day);
      return dt.toISOString().slice(0, 10);
    }
    return y + "-" + m + "-" + d;
  }
  function bucketLabel(key, bucket) {
    if (bucket === "month") return MONTHS[+key.slice(5, 7) - 1] + " " + key.slice(0, 4);
    if (bucket === "day" || bucket === "week") return key.slice(8, 10) + "." + key.slice(5, 7) + "." + key.slice(2, 4);
    return key;
  }

  // ── агрегация ──────────────────────────────────────────────────────────────
  function aggregate(rows, mIdx, kind) {
    if (kind === "count") return rows.length;
    var nums = [];
    var seen = null;
    for (var i = 0; i < rows.length; i++) {
      var v = val(rows[i], mIdx);
      if (kind === "count_distinct") {
        if (v !== null && v !== undefined) { (seen || (seen = new Set())).add(String(v)); }
        continue;
      }
      if (typeof v === "number" && isFinite(v)) nums.push(v);
    }
    if (kind === "count_distinct") return seen ? seen.size : 0;
    if (!nums.length) return 0;
    var sum = 0;
    for (var j = 0; j < nums.length; j++) sum += nums[j];
    if (kind === "avg") return sum / nums.length;
    if (kind === "min") return Math.min.apply(null, nums);
    if (kind === "max") return Math.max.apply(null, nums);
    if (kind === "median") { nums.sort(function (a, b) { return a - b; }); return nums[nums.length >> 1]; }
    return sum;
  }

  function groupSeries(rows, spec) {
    // Вернуть [{key,label,value,rows}] по измерению spec.dimension.
    var di = idx(spec.dimension), mi = idx(spec.measure);
    var kind = spec.agg || (spec.measure ? "sum" : "count");
    var isTime = colType(spec.dimension) === "date";
    var bucket = spec.bucket;
    if (isTime && !bucket) {
      var col = COLS[di];
      bucket = autoBucket(col.min, col.max);
    }
    var map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var raw = val(rows[i], di);
      var key = isTime ? bucketKey(raw, bucket) : keyOf(raw);
      if (key === null) continue;
      var bucketRows = map.get(key);
      if (!bucketRows) { bucketRows = []; map.set(key, bucketRows); }
      bucketRows.push(rows[i]);
    }
    var out = [];
    map.forEach(function (rs, key) {
      out.push({ key: key, label: isTime ? bucketLabel(key, bucket) : key, value: aggregate(rs, mi, kind), rows: rs });
    });
    if (isTime) out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    else if (spec.sort === "asc") out.sort(function (a, b) { return a.value - b.value; });
    else if (spec.sort === "label") out.sort(function (a, b) { return a.label.localeCompare(b.label, "ru"); });
    else out.sort(function (a, b) { return b.value - a.value; });
    if (!isTime && spec.limit && out.length > spec.limit) {
      var head = out.slice(0, spec.limit);
      var restRows = [];
      var rest = out.slice(spec.limit);
      rest.forEach(function (r) { restRows = restRows.concat(r.rows); });
      if (spec.other !== false) {
        head.push({ key: "__other__", label: "Прочие (" + rest.length + ")", value: aggregate(restRows, mi, kind), rows: restRows, other: true });
      }
      out = head;
    }
    return out;
  }

  // ── фильтры и кросс-фильтрация ─────────────────────────────────────────────
  var state = { filters: {} }; // имя колонки -> {kind:'in'|'range'|'dates'|'search', …}

  function passes(row) {
    for (var name in state.filters) {
      var f = state.filters[name], v = val(row, idx(name));
      if (f.kind === "in") {
        if (!f.values.size) continue;
        if (!f.values.has(keyOf(v))) return false;
      } else if (f.kind === "range") {
        if (typeof v !== "number") return false;
        if (f.min !== null && v < f.min) return false;
        if (f.max !== null && v > f.max) return false;
      } else if (f.kind === "dates") {
        if (!v) return false;
        var s = String(v).slice(0, 10);
        if (f.from && s < f.from) return false;
        if (f.to && s > f.to) return false;
      } else if (f.kind === "search") {
        if (!f.text) continue;
        if (String(v === null ? "" : v).toLowerCase().indexOf(f.text) < 0) return false;
      }
    }
    return true;
  }
  function filteredRows() {
    if (!Object.keys(state.filters).length) return ROWS;
    return ROWS.filter(passes);
  }

  function toggleValueFilter(colName, value) {
    if (idx(colName) < 0) return;
    var f = state.filters[colName];
    if (!f || f.kind !== "in") { f = state.filters[colName] = { kind: "in", values: new Set() }; }
    if (f.values.has(value)) f.values.delete(value); else f.values.add(value);
    if (!f.values.size) delete state.filters[colName];
    render();
  }

  // ── тултип ─────────────────────────────────────────────────────────────────
  var tip = document.createElement("div");
  tip.className = "dash-tip";
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    var pad = 14;
    var x = evt.clientX + pad, y = evt.clientY + pad;
    var r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; }

  // ── SVG-помощники ──────────────────────────────────────────────────────────
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var start = Math.ceil(min / step) * step, ticks = [];
    for (var t = start; t <= max + step * 0.001; t += step) ticks.push(+t.toFixed(10));
    if (!ticks.length) ticks = [min, max];
    return ticks;
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s; }

  function axisFrame(svg, box, ticks, fmtKind, horizontal) {
    ticks.forEach(function (t) {
      if (horizontal) {
        svgEl("line", { x1: box.scaleX(t), x2: box.scaleX(t), y1: box.top, y2: box.bottom, class: "grid" }, svg);
        svgEl("text", { x: box.scaleX(t), y: box.bottom + 16, class: "axis", "text-anchor": "middle" }, svg)
          .textContent = fmtNum(t, fmtKind === "percent" ? "percent" : "compact");
      } else {
        var p = box.scaleY(t);
        svgEl("line", { x1: box.left, x2: box.right, y1: p, y2: p, class: "grid" }, svg);
        svgEl("text", { x: box.left - 8, y: p + 4, class: "axis", "text-anchor": "end" }, svg)
          .textContent = fmtNum(t, fmtKind === "percent" ? "percent" : "compact");
      }
    });
  }

  // ── графики ────────────────────────────────────────────────────────────────
  var CHARTS = {};

  CHARTS.bar = function (host, spec, rows, horizontal) {
    var data = groupSeries(rows, spec);
    if (!data.length) return empty(host);
    var w = host.clientWidth || 600, h = spec.height || 280;
    var maxV = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([0]));
    var minV = Math.min.apply(null, data.map(function (d) { return d.value; }).concat([0]));
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var padL = horizontal ? Math.min(180, Math.max(90, w * 0.28)) : 56;
    var box = { left: padL, right: w - (horizontal ? 74 : 12), top: 10, bottom: h - (horizontal ? 26 : 44) };
    var ticks = niceTicks(minV, maxV, 4);
    var lo = Math.min(minV, ticks[0]), hi = Math.max(maxV, ticks[ticks.length - 1]);
    if (hi === lo) hi = lo + 1;
    box.scaleX = function (v) { return box.left + (v - lo) / (hi - lo) * (box.right - box.left); };
    box.scaleY = function (v) { return box.bottom - (v - lo) / (hi - lo) * (box.bottom - box.top); };
    axisFrame(svg, box, ticks, spec.format, horizontal);
    var n = data.length;
    var slot = (horizontal ? (box.bottom - box.top) : (box.right - box.left)) / n;
    var thick = Math.max(4, Math.min(46, slot * 0.68));
    data.forEach(function (d, i) {
      var color = spec.color || PALETTE[i % PALETTE.length];
      var active = isActive(spec.dimension, d.key);
      var rect;
      if (horizontal) {
        var cy = box.top + slot * (i + 0.5);
        var x0 = box.scaleX(Math.max(0, lo)), x1 = box.scaleX(d.value);
        rect = svgEl("rect", { x: Math.min(x0, x1), y: cy - thick / 2, width: Math.max(1, Math.abs(x1 - x0)),
          height: thick, rx: 3, fill: color, class: "bar" + (active ? " active" : "") }, svg);
        svgEl("text", { x: box.left - 10, y: cy + 4, class: "axis", "text-anchor": "end" }, svg)
          .textContent = truncate(d.label, Math.floor(padL / 7));
        svgEl("text", { x: Math.max(x0, x1) + 6, y: cy + 4, class: "value" }, svg).textContent = fmtNum(d.value, spec.format || "compact");
      } else {
        var cx = box.left + slot * (i + 0.5);
        var y0 = box.scaleY(Math.max(0, lo)), y1 = box.scaleY(d.value);
        rect = svgEl("rect", { x: cx - thick / 2, y: Math.min(y0, y1), width: thick,
          height: Math.max(1, Math.abs(y1 - y0)), rx: 3, fill: color, class: "bar" + (active ? " active" : "") }, svg);
        var lbl = svgEl("text", { x: cx, y: box.bottom + 16, class: "axis", "text-anchor": "middle" }, svg);
        lbl.textContent = truncate(d.label, Math.max(4, Math.floor(slot / 7)));
        if (n > 6 && d.label.length * 7 > slot) {
          lbl.setAttribute("transform", "rotate(-35 " + cx + " " + (box.bottom + 16) + ")");
          lbl.setAttribute("text-anchor", "end");
        }
      }
      bindPoint(rect, spec, d, spec.dimension);
    });
    return svg;
  };

  CHARTS.hbar = function (host, spec, rows) { return CHARTS.bar(host, spec, rows, true); };

  CHARTS.line = function (host, spec, rows, area) {
    var seriesIdx = idx(spec.series);
    var groups;
    if (seriesIdx >= 0) {
      var m = new Map();
      rows.forEach(function (r) {
        var k = keyOf(val(r, seriesIdx));
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      });
      groups = Array.from(m.entries()).map(function (e) { return { name: e[0], data: groupSeries(e[1], spec) }; });
      groups.sort(function (a, b) {
        var sa = a.data.reduce(function (s, d) { return s + d.value; }, 0);
        var sb = b.data.reduce(function (s, d) { return s + d.value; }, 0);
        return sb - sa;
      });
      if (groups.length > 8) groups = groups.slice(0, 8);
    } else {
      groups = [{ name: spec.measure || "Количество", data: groupSeries(rows, spec) }];
    }
    var keys = [];
    var seenKeys = new Set();
    groups.forEach(function (g) {
      g.data.forEach(function (d) { if (!seenKeys.has(d.key)) { seenKeys.add(d.key); keys.push({ key: d.key, label: d.label }); } });
    });
    keys.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    if (!keys.length) return empty(host);
    var w = host.clientWidth || 600, h = spec.height || 280;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var all = [];
    groups.forEach(function (g) { g.data.forEach(function (d) { all.push(d.value); }); });
    var maxV = Math.max.apply(null, all.concat([0])), minV = Math.min.apply(null, all.concat([0]));
    var box = { left: 56, right: w - 12, top: 12, bottom: h - 40 };
    var ticks = niceTicks(minV, maxV, 4);
    var lo = Math.min(minV, ticks[0]), hi = Math.max(maxV, ticks[ticks.length - 1]);
    if (hi === lo) hi = lo + 1;
    box.scaleY = function (v) { return box.bottom - (v - lo) / (hi - lo) * (box.bottom - box.top); };
    var stepX = keys.length > 1 ? (box.right - box.left) / (keys.length - 1) : 0;
    var px = function (i) { return keys.length > 1 ? box.left + stepX * i : (box.left + box.right) / 2; };
    axisFrame(svg, box, ticks, spec.format, false);
    var everyN = Math.ceil(keys.length / Math.max(2, Math.floor((box.right - box.left) / 70)));
    keys.forEach(function (k, i) {
      if (i % everyN) return;
      svgEl("text", { x: px(i), y: box.bottom + 18, class: "axis", "text-anchor": "middle" }, svg).textContent = k.label;
    });
    groups.forEach(function (g, gi) {
      var color = PALETTE[gi % PALETTE.length];
      var byKey = new Map();
      g.data.forEach(function (d) { byKey.set(d.key, d); });
      var pts = keys.map(function (k, i) {
        var d = byKey.get(k.key);
        return { x: px(i), y: box.scaleY(d ? d.value : 0), d: d || { key: k.key, label: k.label, value: 0, rows: [] } };
      });
      var path = pts.map(function (p, i) { return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
      if (area) {
        var baseY = box.scaleY(Math.max(0, lo));
        svgEl("path", { d: path + " L" + pts[pts.length - 1].x.toFixed(1) + " " + baseY.toFixed(1) +
          " L" + pts[0].x.toFixed(1) + " " + baseY.toFixed(1) + " Z",
          fill: color, "fill-opacity": groups.length > 1 ? 0.14 : 0.18, stroke: "none" }, svg);
      }
      svgEl("path", { d: path, fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      pts.forEach(function (p) {
        var c = svgEl("circle", { cx: p.x, cy: p.y, r: keys.length > 40 ? 2 : 3.5, fill: color, class: "dot" }, svg);
        bindPoint(c, spec, p.d, spec.dimension, g.name);
      });
    });
    if (groups.length > 1) legend(host, groups.map(function (g, i) { return { name: g.name, color: PALETTE[i % PALETTE.length] }; }), spec.series);
    return svg;
  };
  CHARTS.area = function (host, spec, rows) { return CHARTS.line(host, spec, rows, true); };

  CHARTS["stacked-bar"] = function (host, spec, rows) {
    var si = idx(spec.series);
    if (si < 0) return CHARTS.bar(host, spec, rows);
    var base = groupSeries(rows, spec);
    if (!base.length) return empty(host);
    var totals = new Map();
    rows.forEach(function (r) {
      var k = keyOf(val(r, si));
      totals.set(k, (totals.get(k) || 0) + 1);
    });
    var names = Array.from(totals.keys()).sort(function (a, b) { return totals.get(b) - totals.get(a); });
    var keep = names.slice(0, 8);
    if (names.length > 8) names = keep.concat(["Прочие"]);
    var mi = idx(spec.measure), kind = spec.agg || (spec.measure ? "sum" : "count");
    var percent = spec.stack === "percent";
    var stacks = base.map(function (d) {
      var parts = names.map(function (nm) {
        var rs = d.rows.filter(function (r) {
          var v = keyOf(val(r, si));
          return nm === "Прочие" ? keep.indexOf(v) < 0 : v === nm;
        });
        return { name: nm, value: aggregate(rs, mi, kind), rows: rs };
      });
      var total = parts.reduce(function (s, p) { return s + p.value; }, 0) || 1;
      if (percent) parts.forEach(function (p) { p.raw = p.value; p.value = p.value / total; });
      return { label: d.label, key: d.key, parts: parts, total: percent ? 1 : total };
    });
    var w = host.clientWidth || 600, h = spec.height || 300;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var maxV = Math.max.apply(null, stacks.map(function (s) { return s.total; }));
    var box = { left: 56, right: w - 12, top: 12, bottom: h - 44 };
    var ticks = niceTicks(0, maxV, 4);
    var hi = Math.max(maxV, ticks[ticks.length - 1]) || 1;
    box.scaleY = function (v) { return box.bottom - v / hi * (box.bottom - box.top); };
    axisFrame(svg, box, ticks, percent ? "percent" : spec.format, false);
    var slot = (box.right - box.left) / stacks.length;
    var thick = Math.max(6, Math.min(52, slot * 0.7));
    stacks.forEach(function (st, i) {
      var cx = box.left + slot * (i + 0.5), acc = 0;
      st.parts.forEach(function (p, pi) {
        if (!p.value) return;
        var y1 = box.scaleY(acc), y0 = box.scaleY(acc + p.value);
        acc += p.value;
        var rect = svgEl("rect", { x: cx - thick / 2, y: y0, width: thick, height: Math.max(1, y1 - y0),
          fill: PALETTE[pi % PALETTE.length], class: "bar" }, svg);
        bindPoint(rect, spec, { label: st.label, key: st.key, value: percent ? p.raw : p.value, rows: p.rows },
          spec.series, p.name, p.name === "Прочие" ? null : p.name);
      });
      var lbl = svgEl("text", { x: cx, y: box.bottom + 16, class: "axis", "text-anchor": "middle" }, svg);
      lbl.textContent = truncate(st.label, Math.max(4, Math.floor(slot / 7)));
      if (st.label.length * 7 > slot) {
        lbl.setAttribute("transform", "rotate(-35 " + cx + " " + (box.bottom + 16) + ")");
        lbl.setAttribute("text-anchor", "end");
      }
    });
    legend(host, names.map(function (nm, i) { return { name: nm, color: PALETTE[i % PALETTE.length] }; }), spec.series);
    return svg;
  };

  CHARTS.pie = function (host, spec, rows, donut) {
    var data = groupSeries(rows, Object.assign({ limit: 8 }, spec));
    var total = data.reduce(function (s, d) { return s + Math.max(0, d.value); }, 0);
    if (!total) return empty(host);
    var w = host.clientWidth || 400, h = spec.height || 280;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 12, r0 = donut === false ? 0 : R * 0.56;
    var a0 = -Math.PI / 2;
    data.forEach(function (d, i) {
      var frac = Math.max(0, d.value) / total;
      var a1 = a0 + frac * Math.PI * 2;
      var large = frac > 0.5 ? 1 : 0;
      var p = ["M", cx + R * Math.cos(a0), cy + R * Math.sin(a0),
               "A", R, R, 0, large, 1, cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
      if (r0) {
        p = p.concat(["L", cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1),
                      "A", r0, r0, 0, large, 0, cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0), "Z"]);
      } else p = p.concat(["L", cx, cy, "Z"]);
      var path = svgEl("path", { d: p.join(" "), fill: PALETTE[i % PALETTE.length],
        class: "slice" + (isActive(spec.dimension, d.key) ? " active" : "") }, svg);
      bindPoint(path, spec, d, spec.dimension, null, undefined, frac);
      a0 = a1;
    });
    if (r0) {
      svgEl("text", { x: cx, y: cy - 2, class: "donut-value", "text-anchor": "middle" }, svg).textContent = fmtNum(total, spec.format || "compact");
      svgEl("text", { x: cx, y: cy + 18, class: "donut-label", "text-anchor": "middle" }, svg).textContent = spec.measure || "всего";
    }
    legend(host, data.map(function (d, i) {
      return { name: d.label + " · " + fmtNum(d.value / total, "percent"), color: PALETTE[i % PALETTE.length], key: d.key };
    }), spec.dimension);
    return svg;
  };
  CHARTS.donut = CHARTS.pie;

  CHARTS.scatter = function (host, spec, rows) {
    var xi = idx(spec.x), yi = idx(spec.y), ci = idx(spec.series), si = idx(spec.size);
    if (xi < 0 || yi < 0) return empty(host, "нужны поля x и y");
    var pts = [];
    rows.forEach(function (r) {
      var x = val(r, xi), y = val(r, yi);
      if (typeof x !== "number" || typeof y !== "number") return;
      pts.push({ x: x, y: y, c: ci >= 0 ? keyOf(val(r, ci)) : null, s: si >= 0 ? val(r, si) : null, row: r });
    });
    if (!pts.length) return empty(host);
    var w = host.clientWidth || 600, h = spec.height || 300;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var box = { left: 60, right: w - 14, top: 14, bottom: h - 42 };
    var xt = niceTicks(Math.min.apply(null, xs), Math.max.apply(null, xs), 5);
    var yt = niceTicks(Math.min.apply(null, ys), Math.max.apply(null, ys), 4);
    var xlo = Math.min(xt[0], Math.min.apply(null, xs)), xhi = Math.max(xt[xt.length - 1], Math.max.apply(null, xs));
    var ylo = Math.min(yt[0], Math.min.apply(null, ys)), yhi = Math.max(yt[yt.length - 1], Math.max.apply(null, ys));
    box.scaleX = function (v) { return box.left + (v - xlo) / (xhi - xlo || 1) * (box.right - box.left); };
    box.scaleY = function (v) { return box.bottom - (v - ylo) / (yhi - ylo || 1) * (box.bottom - box.top); };
    yt.forEach(function (t) {
      svgEl("line", { x1: box.left, x2: box.right, y1: box.scaleY(t), y2: box.scaleY(t), class: "grid" }, svg);
      svgEl("text", { x: box.left - 8, y: box.scaleY(t) + 4, class: "axis", "text-anchor": "end" }, svg).textContent = fmtNum(t, "compact");
    });
    xt.forEach(function (t) {
      svgEl("text", { x: box.scaleX(t), y: box.bottom + 18, class: "axis", "text-anchor": "middle" }, svg).textContent = fmtNum(t, "compact");
    });
    var names = [];
    var sizes = pts.map(function (p) { return typeof p.s === "number" ? p.s : null; }).filter(function (v) { return v !== null; });
    var smax = sizes.length ? Math.max.apply(null, sizes) : 0;
    pts.forEach(function (p) {
      var gi = 0;
      if (p.c !== null) { gi = names.indexOf(p.c); if (gi < 0) { names.push(p.c); gi = names.length - 1; } }
      var r = smax ? 3 + 9 * Math.sqrt(Math.max(0, p.s) / smax) : 4;
      var c = svgEl("circle", { cx: box.scaleX(p.x), cy: box.scaleY(p.y), r: r,
        fill: PALETTE[gi % PALETTE.length], "fill-opacity": 0.72, class: "dot" }, svg);
      c.addEventListener("mousemove", function (e) {
        showTip(e, "<b>" + esc(spec.x) + ":</b> " + fmtNum(p.x) + "<br><b>" + esc(spec.y) + ":</b> " + fmtNum(p.y) +
          (p.c !== null ? "<br><b>" + esc(spec.series) + ":</b> " + esc(p.c) : "") +
          (p.s !== null ? "<br><b>" + esc(spec.size) + ":</b> " + fmtNum(p.s) : ""));
      });
      c.addEventListener("mouseleave", hideTip);
    });
    svgEl("text", { x: (box.left + box.right) / 2, y: h - 4, class: "axis-title", "text-anchor": "middle" }, svg).textContent = spec.x;
    var midY = (box.top + box.bottom) / 2;
    svgEl("text", { x: 14, y: midY, class: "axis-title", "text-anchor": "middle",
      transform: "rotate(-90 14 " + midY + ")" }, svg).textContent = spec.y;
    if (names.length > 1) legend(host, names.map(function (n, i) { return { name: n, color: PALETTE[i % PALETTE.length] }; }), spec.series);
    return svg;
  };

  CHARTS.histogram = function (host, spec, rows) {
    var ci = idx(spec.column || spec.measure);
    var nums = [];
    rows.forEach(function (r) { var v = val(r, ci); if (typeof v === "number" && isFinite(v)) nums.push(v); });
    if (!nums.length) return empty(host);
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
    var bins = spec.bins || Math.min(24, Math.max(6, Math.round(Math.sqrt(nums.length))));
    var step = (max - min) / bins || 1;
    var counts = new Array(bins).fill(0);
    nums.forEach(function (v) { counts[Math.min(bins - 1, Math.floor((v - min) / step))]++; });
    var w = host.clientWidth || 600, h = spec.height || 260;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    var box = { left: 52, right: w - 12, top: 12, bottom: h - 34 };
    var maxC = Math.max.apply(null, counts);
    var ticks = niceTicks(0, maxC, 4);
    var hi = Math.max(maxC, ticks[ticks.length - 1]) || 1;
    box.scaleY = function (v) { return box.bottom - v / hi * (box.bottom - box.top); };
    axisFrame(svg, box, ticks, "int", false);
    var slot = (box.right - box.left) / bins;
    counts.forEach(function (n, i) {
      var x = box.left + slot * i + 1;
      var rect = svgEl("rect", { x: x, y: box.scaleY(n), width: Math.max(1, slot - 2),
        height: box.bottom - box.scaleY(n), fill: spec.color || PALETTE[0], rx: 2, class: "bar" }, svg);
      rect.addEventListener("mousemove", function (e) {
        showTip(e, "<b>" + fmtNum(min + step * i) + " … " + fmtNum(min + step * (i + 1)) + "</b><br>записей: " + n);
      });
      rect.addEventListener("mouseleave", hideTip);
      if (i % Math.ceil(bins / 8) === 0) {
        svgEl("text", { x: x, y: box.bottom + 16, class: "axis", "text-anchor": "middle" }, svg).textContent = fmtNum(min + step * i, "compact");
      }
    });
    return svg;
  };

  CHARTS.heatmap = function (host, spec, rows) {
    var ri = idx(spec.dimension), ci = idx(spec.series), mi = idx(spec.measure);
    if (ri < 0 || ci < 0) return empty(host, "нужны dimension и series");
    var kind = spec.agg || (spec.measure ? "sum" : "count");
    var rowKeys = [], colKeys = [], cells = new Map();
    rows.forEach(function (r) {
      var a = keyOf(val(r, ri));
      var b = keyOf(val(r, ci));
      if (rowKeys.indexOf(a) < 0) rowKeys.push(a);
      if (colKeys.indexOf(b) < 0) colKeys.push(b);
      var k = a + " " + b;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(r);
    });
    rowKeys = rowKeys.slice(0, spec.limit || 15);
    colKeys = colKeys.sort(function (a, b) { return a.localeCompare(b, "ru"); }).slice(0, 20);
    var vals = [];
    var grid = rowKeys.map(function (a) {
      return colKeys.map(function (b) {
        var rs = cells.get(a + " " + b) || [];
        var v = rs.length ? aggregate(rs, mi, kind) : null;
        if (v !== null) vals.push(v);
        return { a: a, b: b, v: v, rows: rs };
      });
    });
    if (!vals.length) return empty(host);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var w = host.clientWidth || 600;
    var padL = Math.min(170, Math.max(80, w * 0.24)), padT = 26;
    var cw = (w - padL - 8) / colKeys.length, ch = 26;
    var h = padT + ch * rowKeys.length + 8;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h }, host);
    colKeys.forEach(function (b, j) {
      svgEl("text", { x: padL + cw * (j + 0.5), y: 16, class: "axis", "text-anchor": "middle" }, svg)
        .textContent = truncate(String(b), Math.max(3, Math.floor(cw / 7)));
    });
    grid.forEach(function (line, i) {
      svgEl("text", { x: padL - 8, y: padT + ch * i + 17, class: "axis", "text-anchor": "end" }, svg)
        .textContent = truncate(rowKeys[i], Math.floor(padL / 7));
      line.forEach(function (cell, j) {
        var t = cell.v === null ? null : (hi === lo ? 1 : (cell.v - lo) / (hi - lo));
        var rect = svgEl("rect", { x: padL + cw * j + 1, y: padT + ch * i + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 3,
          fill: t === null ? "var(--dash-empty-cell)" : "rgba(79,124,255," + (0.12 + 0.78 * t).toFixed(3) + ")" }, svg);
        if (t !== null) {
          rect.addEventListener("mousemove", function (e) {
            showTip(e, "<b>" + esc(cell.a) + " × " + esc(cell.b) + "</b><br>" + fmtNum(cell.v, spec.format || "compact"));
          });
          rect.addEventListener("mouseleave", hideTip);
          if (cw > 54) {
            svgEl("text", { x: padL + cw * (j + 0.5), y: padT + ch * i + 17, class: "cell-value", "text-anchor": "middle" }, svg)
              .textContent = fmtNum(cell.v, "compact");
          }
        }
      });
    });
    return svg;
  };

  CHARTS.table = function (host, spec, rows) {
    var cols = (spec.columns && spec.columns.length ? spec.columns : COLS.slice(0, 8).map(function (c) { return c.name; }))
      .filter(function (n) { return idx(n) >= 0; });
    var st = spec.__state || (spec.__state = { sort: spec.sortBy || null, dir: -1, page: 0, q: "" });
    var data = rows.slice();
    if (st.q) {
      var q = st.q.toLowerCase();
      data = data.filter(function (r) {
        return cols.some(function (n) { return String(val(r, idx(n)) || "").toLowerCase().indexOf(q) >= 0; });
      });
    }
    if (st.sort) {
      var si = idx(st.sort);
      data.sort(function (a, b) {
        var x = val(a, si), y = val(b, si);
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * st.dir;
        return String(x).localeCompare(String(y), "ru") * st.dir;
      });
    }
    var per = spec.pageSize || 25;
    var pages = Math.max(1, Math.ceil(data.length / per));
    st.page = Math.min(st.page, pages - 1);
    var slice = data.slice(st.page * per, st.page * per + per);
    host.innerHTML = '<div class="tbl-bar"><input class="tbl-q" type="search" placeholder="Поиск по таблице…" value="' + esc(st.q) + '">' +
      '<span class="tbl-count">строк: ' + nf0.format(data.length) + "</span></div>" +
      '<div class="tbl-wrap"><table><thead><tr>' +
      cols.map(function (n) {
        var arrow = st.sort === n ? (st.dir < 0 ? " ▾" : " ▴") : "";
        return '<th data-col="' + esc(n) + '" class="' + (colType(n) === "number" ? "num" : "") + '">' + esc(n) + arrow + "</th>";
      }).join("") + "</tr></thead><tbody>" +
      slice.map(function (r) {
        return "<tr>" + cols.map(function (n) {
          var v = val(r, idx(n));
          var num = typeof v === "number";
          var cell = v === null || v === undefined ? "" : esc(num ? fmtNum(v) : keyOf(v));
          return '<td class="' + (num ? "num" : "") + '">' + cell + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      (pages > 1 ? '<div class="tbl-pager"><button data-page="prev">←</button><span>' + (st.page + 1) + " / " + pages +
        '</span><button data-page="next">→</button></div>' : "");
    var qi = host.querySelector(".tbl-q");
    qi.addEventListener("input", function () {
      st.q = qi.value; st.page = 0;
      CHARTS.table(host, spec, rows);
      var again = host.querySelector(".tbl-q");
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });
    host.querySelectorAll("th").forEach(function (th) {
      th.addEventListener("click", function () {
        var n = th.getAttribute("data-col");
        if (st.sort === n) st.dir = -st.dir; else { st.sort = n; st.dir = colType(n) === "number" ? -1 : 1; }
        CHARTS.table(host, spec, rows);
      });
    });
    host.querySelectorAll("[data-page]").forEach(function (b) {
      b.addEventListener("click", function () {
        st.page += b.getAttribute("data-page") === "next" ? 1 : -1;
        st.page = Math.max(0, Math.min(pages - 1, st.page));
        CHARTS.table(host, spec, rows);
      });
    });
    return null;
  };

  // ── общие детали графиков ──────────────────────────────────────────────────
  function empty(host, msg) {
    host.innerHTML = '<div class="dash-empty">' + esc(msg || "Нет данных при текущих фильтрах") + "</div>";
    return null;
  }
  function isActive(colName, key) {
    var f = state.filters[colName];
    return !!(f && f.kind === "in" && f.values.has(key));
  }
  function bindPoint(node, spec, d, filterCol, seriesName, seriesFilterValue, frac) {
    node.addEventListener("mousemove", function (e) {
      var html = "<b>" + esc(d.label) + "</b>";
      if (seriesName) html += "<br>" + esc(seriesName);
      html += "<br>" + esc(spec.measure || "Записей") + ": " + fmtNum(d.value, spec.format || (spec.measure ? "compact" : "int"));
      if (frac !== undefined) html += " (" + fmtNum(frac, "percent") + ")";
      if (d.rows && d.rows.length) html += '<br><span class="tip-hint">строк: ' + nf0.format(d.rows.length) + " · клик — фильтр</span>";
      showTip(e, html);
    });
    node.addEventListener("mouseleave", hideTip);
    var value = seriesFilterValue !== undefined ? seriesFilterValue : d.key;
    if (filterCol && value !== null && idx(filterCol) >= 0 && !d.other && colType(filterCol) !== "date") {
      node.style.cursor = "pointer";
      node.addEventListener("click", function () { hideTip(); toggleValueFilter(filterCol, value); });
    }
  }
  function legend(host, items, filterCol) {
    var box = document.createElement("div");
    box.className = "legend";
    items.forEach(function (it) {
      var el = document.createElement("span");
      el.className = "legend-item" + (it.key && isActive(filterCol, it.key) ? " active" : "");
      el.innerHTML = '<i style="background:' + it.color + '"></i>' + esc(it.name);
      if (it.key && filterCol && idx(filterCol) >= 0) {
        el.style.cursor = "pointer";
        el.addEventListener("click", function () { toggleValueFilter(filterCol, it.key); });
      }
      box.appendChild(el);
    });
    host.appendChild(box);
  }

  // ── KPI ────────────────────────────────────────────────────────────────────
  function renderKpis(rows) {
    var host = document.getElementById("kpis");
    if (!host) return;
    host.innerHTML = "";
    (CFG.kpis || []).forEach(function (k) {
      var mi = idx(k.column), kind = k.agg || (k.column ? "sum" : "count");
      var v = aggregate(rows, mi, kind);
      var all = aggregate(ROWS, mi, kind);
      var card = document.createElement("div");
      card.className = "kpi";
      // Доля осмысленна только для аддитивных агрегатов: «среднее — 100,2 %
      // от всех данных» ничего не значит и сбивает с толку.
      var additive = kind === "sum" || kind === "count" || kind === "count_distinct";
      var share = all ? v / all : 1;
      var showShare = additive && rows.length !== ROWS.length && isFinite(share);
      card.innerHTML = '<div class="kpi-label">' + esc(k.label || k.column || "Записей") + "</div>" +
        '<div class="kpi-value">' + esc(fmtNum(v, k.format || (kind === "count" || kind === "count_distinct" ? "int" : "compact"))) + "</div>" +
        (showShare ? '<div class="kpi-sub">' + fmtNum(share, "percent") + " от всех данных</div>"
                   : (k.hint ? '<div class="kpi-sub">' + esc(k.hint) + "</div>" : ""));
      host.appendChild(card);
    });
  }

  // ── панель фильтров ────────────────────────────────────────────────────────
  function buildFilters() {
    var host = document.getElementById("filters");
    if (!host) return;
    (CFG.filters || []).forEach(function (f) {
      var i = idx(f.column);
      if (i < 0) return;
      var col = COLS[i];
      var type = f.type || (col.type === "date" ? "daterange"
        : col.type === "number" && col.role === "measure" ? "range" : "multiselect");
      var wrap = document.createElement("div");
      wrap.className = "filter";
      wrap.innerHTML = "<label>" + esc(f.label || col.name) + "</label>";
      if (type === "multiselect") {
        var values = [];
        var seen = new Set();
        ROWS.forEach(function (r) {
          var s = keyOf(r[i]);
          if (!seen.has(s)) { seen.add(s); values.push(s); }
        });
        values.sort(function (a, b) { return a.localeCompare(b, "ru"); });
        var btn = document.createElement("button");
        btn.className = "ms-btn";
        btn.type = "button";
        var pop = document.createElement("div");
        pop.className = "ms-pop";
        pop.hidden = true;
        pop.innerHTML = '<input class="ms-search" type="search" placeholder="найти…"><div class="ms-list"></div>' +
          '<div class="ms-actions"><button type="button" data-act="all">все</button><button type="button" data-act="none">сбросить</button></div>';
        var list = pop.querySelector(".ms-list");
        var paint = function () {
          var f2 = state.filters[col.name];
          var chosen = f2 && f2.kind === "in" ? f2.values : new Set();
          btn.textContent = chosen.size
            ? (chosen.size === 1 ? truncate(Array.from(chosen)[0], 24) : "выбрано: " + chosen.size)
            : "все (" + values.length + ")";
          btn.classList.toggle("on", chosen.size > 0);
          var q = pop.querySelector(".ms-search").value.toLowerCase();
          list.innerHTML = values.filter(function (v) { return !q || v.toLowerCase().indexOf(q) >= 0; }).slice(0, 400)
            .map(function (v) {
              return '<label class="ms-opt"><input type="checkbox" value="' + esc(v) + '"' + (chosen.has(v) ? " checked" : "") + ">" + esc(v) + "</label>";
            }).join("");
          list.querySelectorAll("input").forEach(function (cb) {
            cb.addEventListener("change", function () { toggleValueFilter(col.name, cb.value); });
          });
        };
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          document.querySelectorAll(".ms-pop").forEach(function (p) { if (p !== pop) p.hidden = true; });
          pop.hidden = !pop.hidden;
          if (!pop.hidden) pop.querySelector(".ms-search").focus();
        });
        pop.addEventListener("click", function (e) { e.stopPropagation(); });
        pop.querySelector(".ms-search").addEventListener("input", paint);
        pop.querySelectorAll("[data-act]").forEach(function (b) {
          b.addEventListener("click", function () {
            if (b.getAttribute("data-act") === "none") delete state.filters[col.name];
            else state.filters[col.name] = { kind: "in", values: new Set(values) };
            render();
          });
        });
        wrap.appendChild(btn);
        wrap.appendChild(pop);
        wrap.__paint = paint;
      } else if (type === "range") {
        var lo = document.createElement("input"), hiI = document.createElement("input");
        lo.type = hiI.type = "number";
        lo.placeholder = fmtNum(col.min);
        hiI.placeholder = fmtNum(col.max);
        lo.className = hiI.className = "num-in";
        var applyRange = function () {
          var a = lo.value === "" ? null : +lo.value, b = hiI.value === "" ? null : +hiI.value;
          if (a === null && b === null) delete state.filters[col.name];
          else state.filters[col.name] = { kind: "range", min: a, max: b };
          render();
        };
        lo.addEventListener("change", applyRange);
        hiI.addEventListener("change", applyRange);
        var pair = document.createElement("div");
        pair.className = "pair";
        pair.appendChild(lo);
        pair.appendChild(hiI);
        wrap.appendChild(pair);
      } else if (type === "daterange") {
        var from = document.createElement("input"), to = document.createElement("input");
        from.type = to.type = "date";
        from.className = to.className = "num-in";
        if (col.min) from.value = String(col.min).slice(0, 10);
        if (col.max) to.value = String(col.max).slice(0, 10);
        var applyDates = function () {
          if (!from.value && !to.value) delete state.filters[col.name];
          else state.filters[col.name] = { kind: "dates", from: from.value || null, to: to.value || null };
          render();
        };
        from.addEventListener("change", applyDates);
        to.addEventListener("change", applyDates);
        var pair2 = document.createElement("div");
        pair2.className = "pair";
        pair2.appendChild(from);
        pair2.appendChild(to);
        wrap.appendChild(pair2);
      } else if (type === "search") {
        var inp = document.createElement("input");
        inp.type = "search";
        inp.className = "num-in";
        inp.placeholder = "текст…";
        inp.addEventListener("input", function () {
          if (!inp.value) delete state.filters[col.name];
          else state.filters[col.name] = { kind: "search", text: inp.value.toLowerCase() };
          render();
        });
        wrap.appendChild(inp);
      }
      host.appendChild(wrap);
    });
    document.addEventListener("click", function () {
      document.querySelectorAll(".ms-pop").forEach(function (p) { p.hidden = true; });
    });
  }

  function renderChips(rows) {
    var host = document.getElementById("chips");
    if (host) {
      var parts = [];
      for (var name in state.filters) {
        var f = state.filters[name], text;
        if (f.kind === "in") text = name + ": " + (f.values.size > 3 ? f.values.size + " знач." : Array.from(f.values).join(", "));
        else if (f.kind === "range") text = name + ": " + (f.min === null ? "…" : fmtNum(f.min)) + " – " + (f.max === null ? "…" : fmtNum(f.max));
        else if (f.kind === "dates") text = name + ": " + (f.from || "…") + " – " + (f.to || "…");
        else text = name + ": «" + f.text + "»";
        parts.push('<span class="chip" data-col="' + esc(name) + '">' + esc(text) + " ✕</span>");
      }
      host.innerHTML = parts.length ? parts.join("") + '<button class="chip-reset" type="button">сбросить всё</button>' : "";
      host.querySelectorAll(".chip").forEach(function (c) {
        c.addEventListener("click", function () { delete state.filters[c.getAttribute("data-col")]; render(); });
      });
      var rst = host.querySelector(".chip-reset");
      if (rst) rst.addEventListener("click", function () { state.filters = {}; render(); });
    }
    var cnt = document.getElementById("rowcount");
    if (cnt) {
      cnt.textContent = rows.length === ROWS.length
        ? nf0.format(ROWS.length) + " записей"
        : nf0.format(rows.length) + " из " + nf0.format(ROWS.length) + " записей";
    }
  }

  // ── сборка сетки и общий рендер ────────────────────────────────────────────
  function buildGrid() {
    var grid = document.getElementById("charts");
    if (!grid) return;
    (CFG.charts || []).forEach(function (spec, i) {
      var card = document.createElement("section");
      card.className = "card";
      card.style.setProperty("--span", spec.span || 6);
      card.innerHTML = "<header><h2>" + esc(spec.title || spec.type) + "</h2>" +
        (spec.note ? '<p class="note">' + esc(spec.note) + "</p>" : "") + "</header>" +
        '<div class="plot" id="plot-' + i + '"></div>';
      grid.appendChild(card);
    });
  }

  var rafId = null;
  function render() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () {
      rafId = null;
      var rows = filteredRows();
      renderKpis(rows);
      renderChips(rows);
      document.querySelectorAll(".filter").forEach(function (f) { if (f.__paint) f.__paint(); });
      (CFG.charts || []).forEach(function (spec, i) {
        var host = document.getElementById("plot-" + i);
        if (!host) return;
        host.innerHTML = "";
        var fn = CHARTS[spec.type] || CHARTS.bar;
        try {
          fn(host, spec, rows, spec.type === "donut" ? true : spec.type === "pie" ? false : undefined);
        } catch (e) {
          host.innerHTML = '<div class="dash-empty">Ошибка отрисовки: ' + esc(e.message) + "</div>";
        }
      });
    });
  }

  // ── экспорт и тема ─────────────────────────────────────────────────────────
  function exportCsv() {
    var rows = filteredRows();
    var names = COLS.map(function (c) { return c.name; });
    var lines = [names.join(";")];
    rows.forEach(function (r) {
      lines.push(names.map(function (n, i) {
        var v = r[i];
        if (v === null || v === undefined) return "";
        var s = String(v);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";"));
    });
    // BOM — чтобы Excel открыл кириллицу в UTF-8 без «кракозябр».
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (D.title || "data").replace(/[^\wа-яА-Я -]/g, "").trim() + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function initTheme() {
    var btn = document.getElementById("theme");
    if (!btn) return;
    var saved = null;
    try { saved = localStorage.getItem("dash-theme"); } catch (e) { /* приватный режим */ }
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      var next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("dash-theme", next); } catch (e) { /* игнорируем */ }
      render();
    });
  }

  // ── старт ──────────────────────────────────────────────────────────────────
  function init() {
    buildFilters();
    buildGrid();
    initTheme();
    var ex = document.getElementById("export");
    if (ex) ex.addEventListener("click", exportCsv);
    render();
    var t = null;
    addEventListener("resize", function () { clearTimeout(t); t = setTimeout(render, 150); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
