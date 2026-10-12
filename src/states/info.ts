import { menuScreen } from '../ui/menus/common';
import { drawHelp } from '../ui/menus/help';
import type { Game, State } from './game';

export class HelpState implements State {
  constructor(
    private readonly game: Game,
    private readonly back: State,
  ) {}

  update(): void {
    const i = this.game.input;
    if (i.pressed('enter') || i.pressed('back') || i.pressed('help')) {
      this.game.audio.ui('back');
      this.game.set(this.back);
    }
  }

  tap(): void {
    this.game.input.tapVirtual('enter');
  }

  render(g: CanvasRenderingContext2D): void {
    menuScreen(g, () => drawHelp(g, this.game.input.getBindings(), this.game.touch));
  }
}
