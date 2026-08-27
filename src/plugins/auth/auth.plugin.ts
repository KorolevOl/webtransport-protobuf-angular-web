// auth.plugin.ts — подключение плагина «auth» (реестр DI, корневой §7).
//
// Подключение = одна запись `provideAuthPlugin(base)` в app.config.ts.
// Отключение = убрать запись; замена транспорта = другой `base`/ITransport (SEAM).
// Компоненты приложения знают только `AuthService`/`AuthState` — не транспорт.

import type { Provider } from '@angular/core';

import { ITRANSPORT, HttpTransport } from '../../core/transport/transport-http';
import { SessionTokenStore, TOKEN_STORE } from '../../core/session/token-store';
import { appLog, setLogLevel } from '../../core/log/logger';
import { AuthService } from './auth.service';
import { AuthState } from './auth.state';

export interface AuthPluginConfig {
  /** Базовый URL бэка (dev: http://127.0.0.1:8443/v1/exchange). */
  base: string;
  /** Таймаут запроса, мс. */
  timeoutMs?: number;
  /** Уровень логирования (dev: 'debug'). */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export function provideAuthPlugin(config: AuthPluginConfig): Provider[] {
  setLogLevel(config.logLevel ?? 'info');
  appLog('auth').info('plugin:boot', {
    base: config.base,
    timeoutMs: config.timeoutMs ?? 15000,
    transport: 'http/envelope',
  });
  return [
    {
      provide: ITRANSPORT,
      useValue: new HttpTransport(config.base, config.timeoutMs ?? 15000),
    },
    {
      provide: TOKEN_STORE,
      useValue: new SessionTokenStore(),
    },
    AuthService,
    AuthState,
  ];
}
