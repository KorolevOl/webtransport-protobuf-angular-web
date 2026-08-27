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
  template: `
    <div class="home">
      <header class="top">
        <strong>AWP · Web</strong>
        <a class="link" routerLink="/login">Войти заново</a>
      </header>

      @if (state.isAuthenticated()) {
        <section class="card">
          <h3>Сессия активна</h3>
          <dl class="kv">
            <dt>e-mail</dt>
            <dd>{{ state.email() || '(не задано сервером)' }}</dd>

            <dt>Имя</dt>
            <dd>{{ state.displayName() || '—' }}</dd>

            <dt>транспорт</dt>
            <dd>{{ transportName() }} (<code>POST /v1/exchange</code> · <code>Content-Type: application/octet-stream</code>)</dd>

            <dt>access-токен</dt>
            <dd>{{ tokenPreview() }} <span class="muted">({{ state.email() ? 'получен' : 'restore' }})</span></dd>
          </dl>
        </section>
      } @else {
        <section class="card">
          <h3>Вы не залогинены</h3>
          <p>
            <a routerLink="/login">Войти</a> или
            <a routerLink="/register">зарегистрироваться</a>.
          </p>
        </section>
      }

      @if (state.isAuthenticated()) {
        <button class="btn-danger" type="button" (click)="onLogout()" [disabled]="busy()">Выйти</button>
      }

      <p class="foot muted">
        Живой обмен (без моков):
        <code>web → server</code> POST <code>/v1/exchange</code> body <code>Envelope(case=loginRequest | registerRequest | logoutRequest)</code>
      </p>
    </div>
  `,
  styles: [`
    .home { max-width: 30rem; margin: 2rem auto; }
    .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .link { color: inherit; }
    .card { border: 1px solid #d1d5db; border-radius: 0.6rem; padding: 1rem 1.25rem; margin: 1rem 0; }
    .kv { display: grid; grid-template-columns: 11rem 1fr; gap: 0.5rem 1rem; margin: 1rem 0 0; }
    .kv dt { color: #6b7280; }
    .kv dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    .muted { color: #6b7280; font-size: 0.85rem; }
    .btn-danger { margin-top: 1rem; padding: 0.55rem 1rem; border-radius: 0.45rem; border: 1px solid #b91c1c; background: white; color: #b91c1c; cursor: pointer; }
    .btn-danger[disabled] { opacity: 0.6; cursor: not-allowed; }
    .foot { margin-top: 2rem; }
    code { background: #f3f4f6; padding: 0.05rem 0.25rem; border-radius: 0.25rem; font-size: 0.85em; }
  `]
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
