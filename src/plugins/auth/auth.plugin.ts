// auth.plugin.ts — подключение плагина «auth» (реестр DI, корневой §7).
//
// Подключение = одна запись `provideAuthPlugin(config)` в app.config.ts.
// Отключение = убрать запись; замена транспорта = другой `config.transport` (SEAM).
// Компоненты приложения знают только `AuthService`/`AuthState` — не транспорт.
//
// Транспорты доступны (выбираются через `config.transport.kind`):
//   • `http`         — браузер fetch → Node:8443 (POST /v1/exchange, Envelope bytes).
//   • `webtransport` — браузер → Go edge (QUIC/H3) → Node (4B BE length + Envelope).
//     Обязателен (Chromium): `pinSha256Hex` (SHA-256 от DER leaf-серта, короткий ECDSA;
//     см. `webtransport-protobuf-certs/README.md` ⭐). URL — IPv4-литерал, не `localhost`.

import type { Provider } from '@angular/core';

import { ITRANSPORT, HttpTransport } from '../../core/transport/transport-http';
import { WebTransportAdapter, type WebTransportAdapterConfig } from '../../core/transport/web-transport-adapter';
import { ITransport } from '../../core/transport/transport';
import { SessionTokenStore, TOKEN_STORE } from '../../core/session/token-store';
import { appLog, setLogLevel } from '../../core/log/logger';
import { AuthService } from './auth.service';
import { AuthState } from './auth.state';

export interface AuthPluginHttpTransportConfig {
  readonly kind: 'http';
  /** Базовый URL бэка (dev: `http://127.0.0.1:8443/v1/exchange`). */
  readonly base: string;
  readonly timeoutMs?: number;
}

export interface AuthPluginWebTransportConfig {
  readonly kind: 'webtransport';
  /** Endpoint WebTransport (dev: `https://127.0.0.1:9443/awp`). IPv4-литерал, не `localhost`. */
  readonly url: string;
  /** ALPN (дефолт `awp-v1`). */
  readonly protocols?: readonly string[];
  /** SHA-256 от DER leaf-серта, hex (64). Обязателен для Chromium (pinning). */
  readonly pinSha256Hex?: string;
  readonly timeoutMs?: number;
}

export type AuthPluginTransportConfig = AuthPluginHttpTransportConfig | AuthPluginWebTransportConfig;

export interface AuthPluginConfig {
  /** Транспорт: `http` (Node:8443) или `webtransport` (edge QUIC/H3 → Node). */
  readonly transport: AuthPluginTransportConfig;
  /** Уровень логирования (dev: `'debug'`). */
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Сборка списка DI-провайдеров плагина «auth».
 *
 * Транспорт — ОДИН (SEAM, корневая §7): выбор идёт по `config.transport.kind`.
 * Подключение / отключение / hot-swap = сменить `kind` в app.config.ts.
 */
export function provideAuthPlugin(config: AuthPluginConfig): Provider[] {
  setLogLevel(config.logLevel ?? 'info');
  const t = config.transport;
  let transport: ITransport;
  let transportName: string;
  if (t.kind === 'http') {
    transport = new HttpTransport(t.base, t.timeoutMs ?? 15000);
    transportName = 'http/envelope';
  } else {
    const wtConfig: WebTransportAdapterConfig = {
      url: t.url,
      protocols: t.protocols,
      pinSha256Hex: t.pinSha256Hex,
      timeoutMs: t.timeoutMs ?? 15000,
    };
    transport = new WebTransportAdapter(wtConfig);
    transportName = 'webtransport/envelope';
  }
  appLog('auth').info('plugin:boot', {
    transport: transportName,
    detail: t.kind === 'http' ? { base: t.base } : { url: t.url, pin: t.pinSha256Hex != null },
  });
  return [
    { provide: ITRANSPORT, useValue: transport },
    { provide: TOKEN_STORE, useValue: new SessionTokenStore() },
    AuthService,
    AuthState,
  ];
}
