#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сборка автономного HTML-дашборда из data.json + config.json.

На выходе один файл: разметка, стили, скрипт и сами данные внутри. Он
открывается двойным кликом с диска, работает без интернета и без сервера —
это важно, потому что дашборд обычно пересылают коллегам по почте.

Команды:
  check <config.json> --data <data.json>              — проверить конфиг
  build <config.json> --data <data.json> --out d.html — собрать дашборд
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")

CHART_TYPES = {
    "bar", "hbar", "line", "area", "stacked-bar", "pie", "donut",
    "scatter", "histogram", "heatmap", "table",
}
AGGS = {"sum", "avg", "count", "count_distinct", "min", "max", "median"}
FILTER_TYPES = {"multiselect", "range", "daterange", "search"}

HTML = """<!doctype html>
<html lang="ru"{theme_attr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>{title}</h1>
      {subtitle}
    </div>
    <div class="spacer"></div>
    <span id="rowcount"></span>
    <button id="export" type="button">Выгрузить CSV</button>
    <button id="theme" type="button">Тема</button>
  </div>
  <div class="panel"><div id="filters"></div></div>
  <div id="chips"></div>
  <div id="kpis"></div>
  <div id="charts"></div>
</div>
<script id="dash-data" type="application/json">{data}</script>
<script>
window.__DASH__ = JSON.parse(document.getElementById("dash-data").textContent);
</script>
<script>
{js}
</script>
</body>
</html>
"""


def load(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def validate(config: dict, data: dict) -> list[str]:
    """Собрать ВСЕ проблемы конфига разом: чинить их по одной — долго."""
    cols = {c["name"]: c for c in data["columns"]}
    errs: list[str] = []

    def need(name, where, kinds=None):
        if name is None:
            return
        if name not in cols:
            near = [n for n in cols if n.lower().strip() == str(name).lower().strip()]
            hint = " (возможно, имелось в виду «%s»)" % near[0] if near else ""
            errs.append("%s: колонки «%s» нет в данных%s" % (where, name, hint))
        elif kinds and cols[name]["type"] not in kinds:
            errs.append("%s: колонка «%s» имеет тип %s, а нужен %s"
                        % (where, name, cols[name]["type"], "/".join(sorted(kinds))))

    for i, f in enumerate(config.get("filters") or []):
        where = "фильтр #%d" % (i + 1)
        if not f.get("column"):
            errs.append("%s: не указана column" % where)
        need(f.get("column"), where)
        if f.get("type") and f["type"] not in FILTER_TYPES:
            errs.append("%s: тип «%s» неизвестен (%s)" % (where, f["type"], ", ".join(sorted(FILTER_TYPES))))
        if f.get("type") == "daterange":
            need(f.get("column"), where, {"date"})
        if f.get("type") == "range":
            need(f.get("column"), where, {"number"})

    for i, k in enumerate(config.get("kpis") or []):
        where = "KPI #%d «%s»" % (i + 1, k.get("label", ""))
        agg = k.get("agg", "sum" if k.get("column") else "count")
        if agg not in AGGS:
            errs.append("%s: агрегат «%s» неизвестен (%s)" % (where, agg, ", ".join(sorted(AGGS))))
        if agg in ("sum", "avg", "min", "max", "median"):
            if not k.get("column"):
                errs.append("%s: для агрегата %s нужна column" % (where, agg))
            need(k.get("column"), where, {"number"})
        else:
            need(k.get("column"), where)

    charts = config.get("charts") or []
    if not charts:
        errs.append("в конфиге нет ни одного графика (charts пустой)")
    for i, c in enumerate(charts):
        where = "график #%d «%s»" % (i + 1, c.get("title", c.get("type", "")))
        t = c.get("type")
        if t not in CHART_TYPES:
            errs.append("%s: тип «%s» неизвестен (%s)" % (where, t, ", ".join(sorted(CHART_TYPES))))
            continue
        agg = c.get("agg", "sum" if c.get("measure") else "count")
        if agg not in AGGS:
            errs.append("%s: агрегат «%s» неизвестен" % (where, agg))
        if agg in ("sum", "avg", "min", "max", "median") and c.get("measure"):
            need(c.get("measure"), where, {"number"})
        else:
            need(c.get("measure"), where)
        if t in ("bar", "hbar", "line", "area", "stacked-bar", "pie", "donut", "heatmap"):
            if not c.get("dimension"):
                errs.append("%s: нужна dimension — по какому полю группировать" % where)
            need(c.get("dimension"), where)
            dim = cols.get(c.get("dimension"))
            if dim and dim["type"] != "date" and dim["unique"] > 25 and not c.get("limit") and t != "heatmap":
                errs.append("%s: в «%s» %d уникальных значений — задайте limit (топ-N), иначе график нечитаем"
                            % (where, c["dimension"], dim["unique"]))
            if t in ("line", "area") and dim and dim["type"] != "date":
                errs.append("%s: линия по нечисловой оси «%s» вводит в заблуждение — "
                            "используйте bar/hbar либо возьмите поле-дату" % (where, c["dimension"]))
        need(c.get("series"), where)
        if t == "stacked-bar" and not c.get("series"):
            errs.append("%s: для stacked-bar нужна series — чем набирается стопка" % where)
        if t == "heatmap" and not c.get("series"):
            errs.append("%s: для heatmap нужна series — вторая ось" % where)
        if t == "scatter":
            if not c.get("x") or not c.get("y"):
                errs.append("%s: нужны x и y" % where)
            need(c.get("x"), where, {"number"})
            need(c.get("y"), where, {"number"})
            need(c.get("size"), where, {"number"})
        if t == "histogram":
            col = c.get("column") or c.get("measure")
            if not col:
                errs.append("%s: нужна column — по какому числовому полю распределение" % where)
            need(col, where, {"number"})
        if t == "table":
            for n in c.get("columns") or []:
                need(n, where)
        span = c.get("span", 6)
        if not isinstance(span, int) or not 1 <= span <= 12:
            errs.append("%s: span должен быть целым от 1 до 12 (сетка из 12 колонок)" % where)
    return errs


def build(config: dict, data: dict, out: str) -> dict:
    payload = {
        "title": config.get("title") or data.get("source") or "Дашборд",
        "subtitle": config.get("subtitle") or "",
        "columns": data["columns"],
        "rows": data["rows"],
        "config": config,
    }
    css = open(os.path.join(ASSETS, "dashboard.css"), encoding="utf-8").read()
    js = open(os.path.join(ASSETS, "dashboard.js"), encoding="utf-8").read()
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # </script> внутри данных закрыл бы тег раньше времени.
    blob = blob.replace("</", "<\\/")
    html = HTML.format(
        theme_attr=' data-theme="%s"' % config["theme"] if config.get("theme") in ("light", "dark") else "",
        title=payload["title"],
        subtitle='<p class="sub">%s</p>' % payload["subtitle"] if payload["subtitle"] else "",
        css=css, js=js, data=blob,
    )
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    return {
        "html": os.path.abspath(out),
        "size_kb": round(os.path.getsize(out) / 1024, 1),
        "rows": len(data["rows"]),
        "charts": len(config.get("charts") or []),
        "kpis": len(config.get("kpis") or []),
        "filters": len(config.get("filters") or []),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "build"):
        p = sub.add_parser(name)
        p.add_argument("config")
        p.add_argument("--data", required=True)
        p.add_argument("--out")
    args = ap.parse_args()

    config, data = load(args.config), load(args.data)
    errs = validate(config, data)
    if errs:
        print(json.dumps({"ok": False, "errors": errs}, ensure_ascii=False, indent=2))
        sys.exit(1)
    if args.cmd == "check":
        print(json.dumps({"ok": True, "errors": []}, ensure_ascii=False))
        return
    out = args.out or os.path.splitext(args.config)[0] + ".html"
    result = build(config, data, out)
    result["ok"] = True
    if result["size_kb"] > 6000:
        result["warning"] = ("файл %.0f МБ — многовато для почты; сузьте выборку "
                             "(--max-rows у tabledata.py) или агрегируйте данные заранее"
                             % (result["size_kb"] / 1024))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
