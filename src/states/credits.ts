import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from '../meta';
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

  render(g: CanvasRenderingContext2D): void {
    drawCredits(g, { sel: this.sel, author: AUTHOR_NAME, links: LINKS });
  }
}
