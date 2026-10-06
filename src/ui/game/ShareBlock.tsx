/** The big five-letter table code plus copy / native-share buttons. */
import { shareUrl } from '../../net/index.ts';
import { Button } from '../common/Button.tsx';
import { Icon } from '../common/Icon.tsx';
import { copyText } from '../common/hooks.ts';
import { useToast } from '../common/Toasts.tsx';

export function CodeTiles({ code }: { code: string }) {
  return (
    <div className="tp-lobby-code" role="img" aria-label={`Game code ${code.split('').join(' ')}`}>
      {code.split('').map((ch, i) => (
        <span key={i} className="tp-lobby-code__ch" aria-hidden="true">
          {ch}
        </span>
      ))}
    </div>
  );
}

export function ShareBlock({ code }: { code: string }) {
  const toast = useToast();
  const url = shareUrl(code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? 'Invite link copied.' : `Couldn’t copy. The link is ${url}`, ok ? 'good' : 'error');
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Akabare Panipuri', text: `Join my Akabare Panipuri table: ${code}`, url });
    } catch {
      // cancelled
    }
  };
  return (
    <div className="tp-lobby-share">
      <div className="tp-lobby-share__btns">
        <Button variant="secondary" onClick={copy} icon={<Icon name="copy" size={18} />}>
          Copy invite link
        </Button>
        {canShare ? (
          <Button variant="secondary" onClick={share} icon={<Icon name="share" size={18} />}>
            Share
          </Button>
        ) : null}
      </div>
      <span className="tp-small tp-muted">Friends join from their own phones.</span>
    </div>
  );
}
