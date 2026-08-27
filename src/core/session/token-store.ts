// token-store.ts — Контракт + sessionStorage-реализация хранения пары токенов.
//
// Правило (корневая §1 «Токен и редирект»): источник — ОДИН. Access-токен живёт
// коротко; refresh — долго. Храним в `sessionStorage` (не `localStorage` — не
// переживает закрытие вкладки; это по канону, чтобы не вывозить сессию на другой
// компьютер/вкладку).
//
// SEAM: бизнес-логика обращается ТОЛЬКО к `ITokenStore.replace(...)`, не к
// sessionStorage напрямую. Замена (например, на in-memory в тестах) = смена провайдера.

import { InjectionToken } from '@angular/core';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ITokenStore {
  readonly name: string;
  save(pair: TokenPair): void;
  load(): TokenPair | null;
  clear(): void;
  has(): boolean;
}

const KEY = 'awp.auth.tokens';

export class SessionTokenStore implements ITokenStore {
  readonly name = 'session-storage';

  save(pair: TokenPair): void {
    sessionStorage.setItem(KEY, JSON.stringify(pair));
  }

  load(): TokenPair | null {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
      if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
        return parsed as unknown as TokenPair;
      }
      return null;
    } catch {
      return null;
    }
  }

  clear(): void {
    sessionStorage.removeItem(KEY);
  }

  has(): boolean {
    return sessionStorage.getItem(KEY) != null;
  }
}

export const TOKEN_STORE = new InjectionToken<ITokenStore>('AWP_TOKEN_STORE');
