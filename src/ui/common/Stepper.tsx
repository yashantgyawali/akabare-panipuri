/** Number stepper: [−] value [+], with a typed field in between (min enforced, no max). */
import { useEffect, useState } from 'react';
import { Icon } from './Icon.tsx';

export interface StepperProps {
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
}

export function Stepper({ value, min, max, onChange, label, id, disabled, size = 'md' }: StepperProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    const next = Number.isFinite(n) ? clamp(n) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <div className={`tp-stepper tp-stepper--${size}`} role="group" aria-label={label}>
      <button
        type="button"
        className="tp-stepper__btn"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Icon name="minus" size={18} />
      </button>
      <input
        id={id}
        className="tp-stepper__input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onChange(n);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      <button
        type="button"
        className="tp-stepper__btn"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={`Increase ${label}`}
      >
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
