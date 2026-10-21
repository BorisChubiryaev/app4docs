// Формы (AcroForm): поля читаем через pdf.js, заполняем через pdf-lib.
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { Fonts } from "./fonts";
import type { FormValue } from "./types";

export type FormField = {
  name: string;
  type: "text" | "checkbox" | "radio" | "choice";
  value: FormValue;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  readOnly?: boolean;
  page?: number;
};

/** Подписи вариантов переключателей (в pdf.js видны только «0», «1»…). */
async function radioLabels(data: ArrayBuffer): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const doc = await PDFDocument.load(data.slice(0), { ignoreEncryption: true, updateMetadata: false });
    for (const f of doc.getForm().getFields()) {
      if (f instanceof PDFRadioGroup) out.set(f.getName(), f.getOptions());
    }
  } catch {
    /* останутся технические значения */
  }
  return out;
}

/** Технические значения вариантов переключателя → его варианты в pdf-lib. */
function radioOption(f: PDFRadioGroup, onValue: string): string | undefined {
  const options = f.getOptions();
  if (options.includes(onValue)) return onValue;
  const widgets = f.acroField.getWidgets();
  const i = widgets.findIndex((w) => w.getOnValue()?.decodeText() === onValue);
  return i >= 0 && options.length === widgets.length ? options[i] : undefined;
}

/** Поля формы документа pdf.js (пустой список — формы нет). */
export async function readFormFields(pdf: any, data?: ArrayBuffer): Promise<FormField[]> {
  let objs: Record<string, any[]> | null = null;
  try {
    objs = await pdf.getFieldObjects();
  } catch {
    return [];
  }
  if (!objs) return [];
  const fields: FormField[] = [];
  const hasRadio = Object.values(objs).some((ws) => (ws || []).some((w) => w?.type === "radiobutton"));
  const labels = hasRadio && data ? await radioLabels(data) : new Map<string, string[]>();
  for (const [name, widgets] of Object.entries(objs)) {
    const ws = (widgets || []).filter((w) => w && w.type);
    if (!ws.length) continue;
    const w = ws[0];
    const page = typeof w.page === "number" ? w.page : undefined;
    const readOnly = w.editable === false;
    if (w.type === "text") {
      fields.push({ name, type: "text", value: String(w.value ?? ""), multiline: !!w.multiline, readOnly, page });
    } else if (w.type === "checkbox") {
      const on = ws.some((x) => x.value && x.value !== "Off" && x.value === x.exportValues);
      fields.push({ name, type: "checkbox", value: on, readOnly, page });
    } else if (w.type === "radiobutton") {
      const names = labels.get(name);
      const values = ws.map((x) => String(x.exportValues ?? ""));
      const options = values
        .map((v, i) => ({ value: v, label: names && names.length === values.length ? names[i] : v }))
        .filter((o, i) => o.value && values.indexOf(o.value) === i);
      const value = String(ws.find((x) => x.value && x.value !== "Off")?.value ?? "");
      fields.push({ name, type: "radio", value: value === "Off" ? "" : value, options, readOnly, page });
    } else if (w.type === "combobox" || w.type === "listbox") {
      const options = (w.items || []).map((o: any) => ({
        value: String(o.exportValue ?? o.displayValue ?? ""),
        label: String(o.displayValue ?? o.exportValue ?? ""),
      }));
      const v = Array.isArray(w.value) ? w.value[0] : w.value;
      fields.push({ name, type: "choice", value: String(v ?? ""), options, readOnly, page });
    }
  }
  return fields;
}

/**
 * Записать значения в поля и «впечатать» форму в страницы: заполненные
 * значения станут обычным содержимым и сохранятся при любом объединении.
 */
export async function fillAndFlatten(doc: PDFDocument, values: Record<string, FormValue>, fonts: Fonts) {
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) {
        const text = String(value ?? "");
        const max = f.getMaxLength();
        f.setText(max !== undefined ? text.slice(0, max) : text);
        // Авторазмер (или заранее «подобранный» под одну строку крупный
        // кегль) в многострочном поле даёт огромный обрезанный текст
        if (f.isMultiline()) {
          const m = (f.acroField.getDefaultAppearance() ?? "").match(/([\d.]+)\s+Tf/);
          const size = m ? Number(m[1]) : 0;
          if (!size || size > 14) f.setFontSize(10);
        }
      } else if (f instanceof PDFCheckBox) {
        if (value) f.check();
        else f.uncheck();
      } else if (f instanceof PDFRadioGroup) {
        const option = value ? radioOption(f, String(value)) : undefined;
        if (option) f.select(option);
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        const v = String(value ?? "");
        if (!v) f.clear();
        else if (f.getOptions().includes(v)) f.select(v);
        else if (f instanceof PDFDropdown && f.isEditable()) f.select(v);
      }
    } catch (err) {
      console.warn(`Поле формы «${name}» не заполнено:`, err);
    }
  }
  // Внешний вид полей — шрифтом с кириллицей (стандартный Helvetica её не знает)
  form.updateFieldAppearances(await fonts.regular());
  form.flatten({ updateFieldAppearances: false });
}
