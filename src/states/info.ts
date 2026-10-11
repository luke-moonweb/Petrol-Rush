import { drawHelp } from '../ui/menus';
import { Game, State } from './game';

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

  render(g: CanvasRenderingContext2D): void {
    drawHelp(g, this.game.input.getBindings());
  }
}
