/** All the seats on the table, in seat order (viewer first, clockwise): this is the DOM/tab order. */
import { seatSpots } from './geometry.ts';
import { pileCardWidth, type Stage } from './useStage.ts';
import { Seat3D, type Seat3DProps } from './Seat3D.tsx';

export type SeatBase = Omit<Seat3DProps, 'spot' | 'R' | 'halfW' | 'cardW' | 'stackMax' | 'phone'>;

export function SeatsLayer({ stage, seats }: { stage: Stage; seats: SeatBase[] }) {
  const spots = seatSpots(seats.length, stage.params);
  const cardW = pileCardWidth(stage.D, seats.length, stage.phone);
  const stackMax = Math.round(cardW * (stage.phone ? 2.6 : 2.9));
  return (
    <div className="tp-seats">
      {seats.map((s, i) => (
        <Seat3D key={s.p.id} {...s} spot={spots[i]} R={stage.D / 2} halfW={stage.w / 2} cardW={cardW} stackMax={stackMax} phone={stage.phone} />
      ))}
    </div>
  );
}
