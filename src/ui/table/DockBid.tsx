/** The bid stepper in the dock, with the soft "more than anyone could eat" warning and its confirm step. */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../common/Button.tsx';
import { Stepper } from '../common/Stepper.tsx';
import { cx } from '../common/hooks.ts';

export function BidControl({
  min,
  tableMax,
  verb,
  busy,
  pending,
  onBid,
  initial,
  extra,
}: {
  min: number;
  tableMax: number;
  verb: 'Start the bid' | 'Raise';
  busy: boolean;
  pending: boolean;
  onBid: (amount: number) => void;
  initial?: number;
  /** Rendered at the end of the stepper row (e.g. the Pass button). */
  extra?: ReactNode;
}) {
  const [amount, setAmount] = useState(Math.max(min, initial ?? min));
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setAmount((a) => Math.max(min, a));
  }, [min]);
  useEffect(() => setConfirming(false), [amount, min]);
  const over = amount > tableMax;
  const label = confirming ? `Yes, bid ${amount}` : verb === 'Raise' ? `Raise to ${amount}` : `Open the bid at ${amount}`;
  const hint = over
    ? confirming
      ? `That’s more than anyone could eat (at most ${tableMax}). Sure?`
      : `Heads up: at most ${tableMax} can be eaten right now.`
    : `At most ${tableMax} can be eaten right now.`;
  return (
    <div className="tp-bid">
      <div className="tp-bid__row">
        <Stepper value={amount} min={min} onChange={setAmount} label={verb === 'Raise' ? 'Raise to' : 'Opening bid'} size="lg" disabled={busy} />
        <Button
          variant="primary"
          size="md"
          busy={pending}
          disabled={busy}
          className="tp-bid__go"
          onClick={() => {
            if (over && !confirming) setConfirming(true);
            else onBid(amount);
          }}
        >
          {label}
        </Button>
        {extra}
      </div>
      <p className={cx('tp-bid__hint', over && 'is-over')} role={confirming ? 'alert' : undefined}>
        {hint}
      </p>
    </div>
  );
}
