import type { KeyboardEvent } from "react";

export interface SegmentedOption<T> {
  value: T;
  label: string;
  title?: string;
}

/**
 * Un grupo de opciones excluyentes con semántica de radiogroup: el lector de
 * pantalla anuncia «Self-destructs after, 24 hours, seleccionado» y las
 * flechas mueven la selección, como en cualquier grupo de radios.
 */
export function Segmented<T extends string | number>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons?.[(index + delta + options.length) % options.length]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="seg">
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={option.title}
            className="seg-opt"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
