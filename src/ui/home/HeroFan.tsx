/** Three real cards fanned on the right of the hero: blue puri back, red Akabare, yellow Panipuri. */
import { Card } from '../../cards/index.ts';
import { usePhone } from '../common/hooks.ts';

export function HeroFan() {
  const phone = usePhone();
  const w = phone ? 104 : 190;
  const mid = phone ? 114 : 210;
  return (
    <div className="tp-home-fan" aria-hidden="true">
      <div className="tp-home-fan__card tp-home-fan__card--l">
        <Card back="puri" color="blue" face={null} width={w} decorative />
      </div>
      <div className="tp-home-fan__card tp-home-fan__card--m">
        <Card back="puri" color="red" face="akabare" faceUp width={mid} decorative />
      </div>
      <div className="tp-home-fan__card tp-home-fan__card--r">
        <Card back="puri" color="yellow" face="panipuri" faceUp width={w} decorative />
      </div>
    </div>
  );
}
