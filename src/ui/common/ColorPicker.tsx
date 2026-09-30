/** Six player colours as tiny card backs (radio group). Taken colours are disabled and say by whom. */
import { COLORS, type ColorId } from '../../engine/types.ts';
import { PLAYER_PALETTE, backImageUrl } from '../../cards/index.ts';
import { cx } from './hooks.ts';

export interface ColorPickerProps {
  value: ColorId | null;
  onChange: (c: ColorId) => void;
  /** colour → name of the player who has it (excluding you). */
  taken?: Partial<Record<ColorId, string>>;
  label?: string;
  disabled?: boolean;
}

export function ColorPicker({ value, onChange, taken = {}, label = 'Your colour', disabled }: ColorPickerProps) {
  return (
    <div className="ak-colors" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => {
        const holder = taken[c];
        const selected = value === c;
        const p = PLAYER_PALETTE[c];
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={holder ? `${p.name} (taken by ${holder})` : p.name}
            title={holder ? `${p.name}: ${holder} has it` : p.name}
            className={cx('ak-color', selected && 'ak-color--on', holder && 'ak-color--taken')}
            style={{ ['--c' as string]: p.base, ['--c-light' as string]: p.light }}
            disabled={disabled || !!holder}
            onClick={() => onChange(c)}
          >
            <img src={backImageUrl('puri', c)} alt="" draggable={false} />
            <span className="ak-color__name">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
