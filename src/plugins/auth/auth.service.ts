// auth.service.ts — бизнес-операции аутентификации поверх Envelope-транспорта.
//
// ОДИН носитель деталей транспорта (SEAM, корневая §1): компоненты знают только
// этот сервис (login/register/refresh/logout), не про то, как байты летят.
// Механика Envelope (обёртка → транспорт → проверка пары) — в core/EnvelopeClient;
// здесь только auth-бизнес (исходы: session|error, хранение токенов, AuthState).
// Смена транспорта (HTTP → WebTransport) = смена провайдера ITRANSPORT.

import { Injectable, inject } from '@angular/core';
import { create as pbCreate } from '@bufbuild/protobuf';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  AuthErrorCode,
} from '../../proto-generated/index';

import { protoEnvelopeCodec } from '../../core/codec/envelope-codec';
import type { ITransport } from '../../core/transport/transport';
import { ITRANSPORT } from '../../core/transport/transport-http';
import { appLog } from '../../core/log/logger';
import type { TokenPair, ITokenStore } from '../../core/session/token-store';
import { TOKEN_STORE } from '../../core/session/token-store';
import { EnvelopeClient } from '../../core/envelope/envelope-client';
import type { ResponseTypeOf } from '../../core/envelope/envelope-types';
import { AuthState } from './auth.state';

const log = appLog('auth');

/**
 * Форма oneof-исхода (session | error | tokens) — объединение union'ов всех
 * «ответов сессии» (login/register — session|error, refresh — session|
 * tokens|error), выводится из proto oneof без ручного перечисления.
 */
type SessionOutcome =
  | ResponseTypeOf<'login'>['outcome']
  | ResponseTypeOf<'refresh'>['outcome'];

/** Исключение «ошибка от сервера» (payload.outcome.error). */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(`[auth/${code}] ${message}`);
    this.name = 'AuthError';
  }
}

export interface AuthSessionLocal {
  email: string;
  displayName: string;
  tokens: TokenPair;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly transport: ITransport = inject(ITRANSPORT);
  private readonly store: ITokenStore = inject(TOKEN_STORE);
  private readonly state = inject(AuthState);
  private readonly codec = protoEnvelopeCodec;
  /** Единая обёртка Envelope-операций (base → <base>Request/<base>Response). */
  private readonly client = new EnvelopeClient(this.codec, this.transport);

  // Сессия живёт ТОЛЬКО в AuthState (signals, единый источник правды).
  private get session(): AuthSessionLocal | null {
    return this.state.session();
  }
  private set session(v: AuthSessionLocal | null) {
    this.state.session.set(v);
  }

  // --- публичное состояние (через AuthState) ---

  get currentSession(): AuthSessionLocal | null {
    return this.state.session();
  }

  isAuthenticated(): boolean {
    return this.state.isAuthenticated();
  }

  async login(email: string, password: string): Promise<AuthSessionLocal> {
    log.info('login', { email });
    const request = pbCreate(LoginRequestSchema, { email, password });
    const result = await this.client.call('login', request);
    return this.applySession(result.outcome, 'login', email);
  }

  async register(email: string, password: string, displayName: string): Promise<AuthSessionLocal> {
    log.info('register', { email });
    const request = pbCreate(RegisterRequestSchema, { email, password, displayName });
    const result = await this.client.call('register', request);
    return this.applySession(result.outcome, 'register', email);
  }

  async refresh(): Promise<AuthSessionLocal | null> {
    const s = this.session;
    if (!s) return null;
    log.info('refresh', { had_refresh_token: !!s.tokens.refreshToken });
    const request = pbCreate(RefreshRequestSchema, { refreshToken: s.tokens.refreshToken });
    const result = await this.client.call('refresh', request);
    if (result.outcome.case === 'error') throw this.serverError(result.outcome.value);
    if (result.outcome.case !== 'tokens') throw new Error('refresh: unexpected outcome case');
    const t = result.outcome.value;
    const next: TokenPair = { accessToken: t.accessToken, refreshToken: t.refreshToken };
    this.store.save(next);
    this.session = {
      ...s,
      tokens: next,
      accessExpiresAt: Date.now() + Number(t.accessExpiresIn) * 1000,
      refreshExpiresAt: Date.now() + Number(t.refreshExpiresIn) * 1000,
    };
    log.info('refresh: ok', { access_expires_in: t.accessExpiresIn, refresh_expires_in: t.refreshExpiresIn });
    return this.session;
  }

  async logout(): Promise<void> {
    const s = this.session;
    if (!s) {
      this.store.clear();
      this.session = null;
      return;
    }
    log.info('logout', { email: s.email });
    try {
      const request = pbCreate(LogoutRequestSchema, { refreshToken: s.tokens.refreshToken });
      const result = await this.client.call('logout', request);
      if (result.outcome.case === 'error') {
        log.warn('logout: server reported error, но сессию снимаю локально', result.outcome.value);
      }
    } catch (e) {
      log.warn('logout: транспорт упал, но сессию снимаю локально', e);
    }
    this.store.clear();
    this.session = null;
  }

  // --- внутреннее (auth-бизнес) ---

  private applySession(outcome: SessionOutcome, op: string, email: string): AuthSessionLocal {
    if (outcome.case === 'error') {
      throw this.serverError(outcome.value);
    }
    if (outcome.case !== 'session') throw new Error(`${op}: unexpected outcome case`);
    const session = outcome.value;
    const tokens = session.tokens;
    if (!tokens) throw new Error(`session missing tokens (${op})`);
    const next: TokenPair = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    this.store.save(next);
    this.session = {
      email: session.user?.email ?? email,
      displayName: session.user?.displayName ?? email,
      tokens: next,
      accessExpiresAt: Date.now() + Number(tokens.accessExpiresIn) * 1000,
      refreshExpiresAt: Date.now() + Number(tokens.refreshExpiresIn) * 1000,
    };
    log.info(`${op}: ok`, { email: this.session.email, access_expires_in: tokens.accessExpiresIn });
    return this.session;
  }

  private serverError(e: { code: AuthErrorCode; message: string }): AuthError {
    log.warn('server error', { code: e.code, message: e.message });
    return new AuthError(e.code, e.message);
  }

  /**
   * Восстановить сессию из sessionStorage при старте приложения (вызывает
   * бутстрап плагина). refresh-токен в хранилище — «ещё жив» → показываем
   * «залогинен» и при первом защищённом действии бек решит, жив ли он (401 →
   * редирект на логин по канону §1).
   */
  restoreSession(): void {
    const pair = this.store.load();
    if (!pair) {
      this.session = null;
      return;
    }
    this.session = {
      email: '',
      displayName: '',
      tokens: pair,
      accessExpiresAt: 0,
      refreshExpiresAt: 0,
    };
    log.info('restore: restored tokens from sessionStorage');
  }
}
