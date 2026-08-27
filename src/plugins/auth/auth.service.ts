// auth.service.ts — бизнес-операции аутентификации поверх Envelope-транспорта.
//
// ОДИН носитель деталей транспорта (SEAM, корневая §1): компоненты знают только
// этот сервис (login/register/refresh/logout), не про то, как байты летят.
// Смена транспорта (HTTP → WebTransport) = смена провайдера ITRANSPORT.

import { Injectable, inject } from '@angular/core';
import { create as pbCreate } from '@bufbuild/protobuf';
import { timestampNow } from '@bufbuild/protobuf/wkt';
import {
  EnvelopeSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  type Envelope,
  type LoginResponse,
  AuthErrorCode,
} from '../../proto-generated/index';

import { protoEnvelopeCodec } from '../../core/codec/envelope-codec';
import type { ITransport } from '../../core/transport/transport';
import { ITRANSPORT } from '../../core/transport/transport-http';
import { appLog } from '../../core/log/logger';
import type { TokenPair, ITokenStore } from '../../core/session/token-store';
import { TOKEN_STORE } from '../../core/session/token-store';
import { AuthState } from './auth.state';

const log = appLog('auth');

// --- Типы один от proto-контракта (не «вручную» из памяти) ---
//
// Envelope.payload — дискриминированный union по `case` (codegen v2, oneof):
//   { case: 'loginRequest'; value: LoginRequest } | { case: 'loginResponse'; ... } | ...
// Отсюда выводим ВСЮ номенклатуру кейсов и тип сообщения для каждого кейса —
// IDE будет подсказывать только валидные literals из .proto (при добавлении
// кейса в proto+regen список расширяется автоматически, без правки этого файла).

/** Все валидные кейсы Envelope.payload (без unset-варианта `case: undefined`). */
export type EnvelopeCase = Exclude<Envelope['payload']['case'], undefined>;

/** Тип сообщения, лежащего под кейсом C. Выводится из union без перечисления. */
export type EnvelopeValueOf<C extends EnvelopeCase> =
  Extract<Envelope['payload'], { case: C }>['value'];

/** Форма oneof-исхода ответов (session | error | unset) — берётся прямо из proto-типа. */
type SessionOutcome = LoginResponse['outcome'];

function messageId(): string {
  return 'web-' + Math.random().toString(36).slice(2, 10);
}

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

/** Исключение «транспорт» (сеть/таймаут/не-200). */
export class TransportError extends Error {
  constructor(message: string) {
    super(`[transport] ${message}`);
    this.name = 'TransportError';
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
    const payload = pbCreate(LoginRequestSchema, { email, password });
    const resp = await this.dispatch(payload, 'loginRequest');
    const result = this.expectCase(resp, 'loginResponse', 'login');
    return this.applySession(result.outcome, 'login', email);
  }

  async register(email: string, password: string, displayName: string): Promise<AuthSessionLocal> {
    log.info('register', { email });
    const payload = pbCreate(RegisterRequestSchema, { email, password, displayName });
    const resp = await this.dispatch(payload, 'registerRequest');
    const result = this.expectCase(resp, 'registerResponse', 'register');
    return this.applySession(result.outcome, 'register', email);
  }

  async refresh(): Promise<AuthSessionLocal | null> {
    const s = this.session;
    if (!s) return null;
    log.info('refresh', { had_refresh_token: !!s.tokens.refreshToken });
    const payload = pbCreate(RefreshRequestSchema, { refreshToken: s.tokens.refreshToken });
    const resp = await this.dispatch(payload, 'refreshRequest');
    const result = this.expectCase(resp, 'refreshResponse', 'refresh');
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
      const payload = pbCreate(LogoutRequestSchema, { refreshToken: s.tokens.refreshToken });
      const resp = await this.dispatch(payload, 'logoutRequest');
      const result = this.expectCase(resp, 'logoutResponse', 'logout');
      if (result.outcome.case === 'error') {
        log.warn('logout: server reported error, но сессию снимаю локально', result.outcome.value);
      }
    } catch (e) {
      log.warn('logout: транспорт упал, но сессию снимаю локально', e);
    }
    this.store.clear();
    this.session = null;
  }

  // --- внутреннее ---

  /**
   * Собрать Envelope с payload `{case: C, value: M}`, отправить, вернуть
   * декодированный Envelope. Generic: C ограничен валидными кейсами proto
   * (IDE подсказывает), M ограничен типом сообщения для C (IDE не даст
   * спарить чужое сообщение с кейсом).
   */
  private dispatch<C extends EnvelopeCase>(
    message: EnvelopeValueOf<C>,
    caseName: C,
  ): Promise<Envelope> {
    const t0 = Date.now();
    const env = pbCreate(EnvelopeSchema, {
      messageId: messageId(),
      sentAt: timestampNow(),
      protocolVersion: 1,
      payload: { case: caseName, value: message } as Envelope['payload'],
    });
    const bytes = this.codec.encode(env);
    return this.transport.dispatchEnvelope(bytes).then((raw) => {
      log.debug('dispatch', { case: caseName, ms: Date.now() - t0, bytes: bytes.byteLength });
      return this.codec.decode(raw);
    });
  }

  /**
   * Проверить, что сервер ответил именно кейсом C, и вернуть типизированное
   * сообщение под ним (EnvelopeValueOf<C> — выводится из oneof контракта).
   */
  private expectCase<C extends EnvelopeCase>(env: Envelope, expected: C, op: string): EnvelopeValueOf<C> {
    if (env.payload.case !== expected) {
      log.error(`${op}: unexpected case`, { got: env.payload.case, expected });
      throw new Error(`expected ${expected}, got ${env.payload.case}`);
    }
    return env.payload.value as EnvelopeValueOf<C>;
  }

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
