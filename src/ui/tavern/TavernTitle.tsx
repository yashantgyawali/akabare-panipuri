/** The blocky title over the tavern: AKABARE / PANIPURI in a pixel face with a voxel extrusion, and the Devanagari name. */
import { cx } from '../common/hooks.ts';

export function TavernTitle({ size = 'xl', as: Tag = 'h1', className }: { size?: 'xl' | 'sm'; as?: 'h1' | 'div'; className?: string }) {
  return (
    <Tag className={cx('tv-title', `tv-title--${size}`, className)}>
      <span className="tp-sr">Akabare Panipuri</span>
      <span className="tv-title__word" aria-hidden="true">
        AKABARE
      </span>
      <span className="tv-title__word" aria-hidden="true">
        PANIPURI
      </span>
      {size === 'xl' ? (
        <span className="tv-title__dev" lang="ne" aria-hidden="true">
          अकबरे पानीपुरी
        </span>
      ) : null}
    </Tag>
  );
}
