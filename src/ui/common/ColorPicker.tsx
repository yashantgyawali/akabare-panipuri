/** Six player colours as dots (radio group). Taken colours are disabled and say by whom. */
import { COLORS, type ColorId } from '../../engine/types.ts';
import { PLAYER_PALETTE } from '../../cards/index.ts';
import { cx } from './hooks.ts';

export interface ColorPickerProps {
  value: ColorId | null;
  onChange: (c: ColorId) => void;
  /** colour -> name of the player who has it (excluding you). */
  taken?: Partial<Record<ColorId, string>>;
  label?: string;
  disabled?: boolean;
  /** Dot diameter in px (default 26). */
  size?: number;
}

export function ColorPicker({ value, onChange, taken = {}, label = 'Your colour', disabled, size = 26 }: ColorPickerProps) {
  return (
    <div className="tp-swatches" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => {
        const holder = taken[c];
        const p = PLAYER_PALETTE[c];
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={holder ? `${p.name} (taken by ${holder})` : p.name}
            title={holder ? `${p.name}: ${holder} has it` : p.name}
            className={cx('tp-swatch')}
            style={{ ['--c' as string]: p.base, width: size, height: size }}
            disabled={disabled || !!holder}
            onClick={() => onChange(c)}
          />
        );
      })}
    </div>
  );
}
