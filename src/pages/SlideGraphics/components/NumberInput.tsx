import { useState, type ComponentProps } from "react";

type Props = Pick<ComponentProps<"input">, "aria-label" | "id" | "placeholder" | "title" | "autoComplete"> & {
  value?: number; min: number; max?: number; step?: number | "any"; onValue: (value: number) => void;
};

/** Keep the user's draft while they clear the field or type a decimal. */
export default function NumberInput({ value, min, max, step = "any", onValue, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...props} type="number" min={min} max={max} step={step} value={draft ?? value ?? ""}
    onChange={e => {
      const field = e.currentTarget, n = field.valueAsNumber;
      setDraft(field.value);
      if (Number.isFinite(n) && n >= min && (max === undefined || n <= max) && n !== value) onValue(n);
    }}
    onBlur={e => {
      const n = e.currentTarget.valueAsNumber;
      if (Number.isFinite(n)) {
        const accepted = Math.max(min, Math.min(max ?? Infinity, n));
        if (accepted !== value) onValue(accepted);
      }
      setDraft(null);
    }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
