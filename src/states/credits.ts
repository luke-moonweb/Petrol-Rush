import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from '../meta';
import type { Hit } from '../ui/hit';
import { menuScreen } from '../ui/menus/common';
import { CREDITS_ITEMS, drawCredits } from '../ui/menus/credits';
import type { Game, State } from './game';

const LINKS = [AUTHOR_URL, REPO_URL];

export class CreditsState implements State {
  private sel = 0;

  constructor(
    private readonly game: Game,
    private readonly back: State,
  ) {}

  update(): void {
    const input = this.game.input;
    const audio = this.game.audio;
    const n = CREDITS_ITEMS.length;
    if (input.pressed('up')) {
      this.sel = (this.sel + n - 1) % n;
      audio.ui('move');
    }
    if (input.pressed('down')) {
      this.sel = (this.sel + 1) % n;
      audio.ui('move');
    }
    if (input.pressed('back') || (input.pressed('enter') && CREDITS_ITEMS[this.sel] === 'BACK')) {
      audio.ui('back');
      this.game.set(this.back);
      return;
    }
    if (input.pressed('enter')) {
      audio.ui('ok');
      window.open(LINKS[this.sel], '_blank', 'noopener,noreferrer');
    }
  }

  hover(hit: Hit): void {
    this.sel = hit.id;
  }

  tap(hit: Hit | null): void {
    if (!hit) return;
    this.sel = hit.id;
    this.game.input.tapVirtual('enter');
  }

  render(g: CanvasRenderingContext2D): void {
    menuScreen(g, () => drawCredits(g, { sel: this.sel, author: AUTHOR_NAME, links: LINKS }));
  }
}
