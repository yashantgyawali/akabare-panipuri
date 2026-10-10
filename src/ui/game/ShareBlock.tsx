/** The five-letter table code tiles, and one icon-size copy-link control. */
import { shareUrl } from '../../net/index.ts';
import { IconButton } from '../common/Button.tsx';
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

export function CopyLink({ code }: { code: string }) {
  const toast = useToast();
  const url = shareUrl(code);
  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? 'Link copied' : `Couldn’t copy. The link is ${url}`, ok ? 'good' : 'error');
  };
  return (
    <IconButton label="Copy invite link" className="tp-lobby-copy" onClick={() => void copy()}>
      <Icon name="copy" size={22} />
    </IconButton>
  );
}
