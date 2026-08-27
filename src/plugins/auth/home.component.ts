// home.component.ts — «главная» (post-auth) — показывает сессию и logout.
// Доказательство: если на ней видно email и сработал logout — значит
// реальный запрос `register/login` от фронте дошёл до бэка и вернул сессию.
//
// Никаких «моков»: здесь только то, что сказал бек (через AuthService).

import { Component, inject, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from './auth.service';
import { AuthState } from './auth.state';

@Component({
  selector: 'awp-home',
  imports: [RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly state = inject(AuthState);
  protected readonly busy = signal(false);

  protected readonly transportName = computed(() => 'http/envelope');

  protected tokenPreview(): string {
    const s = this.auth.currentSession;
    if (!s?.tokens.accessToken) return '(нет)';
    const t = s.tokens.accessToken;
    return t.length > 18 ? t.slice(0, 9) + '…' + t.slice(-8) + ` (${t.length} симв.)` : t;
  }

  protected onLogout(): void {
    this.busy.set(true);
    this.auth
      .logout()
      .finally(() => {
        this.busy.set(false);
        this.router.navigateByUrl('/login');
      });
  }
}
