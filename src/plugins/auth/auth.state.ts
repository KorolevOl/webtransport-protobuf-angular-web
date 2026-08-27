// auth.state.ts — реактивное состояние сессии (signals; канон §2).
//
// Components читают `state.session()` (Signal) — подписка реактивная.
// AuthService пишет сюда при login/restore/refresh/logout.

import { Injectable, computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import type { AuthSessionLocal } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthState {
  readonly session = signal<AuthSessionLocal | null>(null);

  readonly isAuthenticated: Signal<boolean> = computed(() => this.session() !== null);
  readonly email: Signal<string> = computed(() => this.session()?.email ?? '');
  readonly displayName: Signal<string> = computed(() => this.session()?.displayName ?? '');
  /** access-токен ещё жив по локальному clock (ориентир; окончательное слово — сервер). */
  readonly accessValid: Signal<boolean> = computed(() => {
    const s = this.session();
    return s !== null && s.accessExpiresAt > Date.now();
  });
}
