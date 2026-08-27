import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Root-компонент: только <router-outlet>.
// Маршруты — плагины (src/plugins/auth/auth.routes.ts) — корневой §7.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html'
})
export class App {}
