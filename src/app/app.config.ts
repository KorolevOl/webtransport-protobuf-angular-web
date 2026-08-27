import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideSignalFormsConfig } from '@angular/forms/signals';

import { routes } from './app.routes';
import { provideAuthPlugin } from '../plugins/auth/auth.plugin';

/**
 * Корневой ApplicationConfig.
 *
 * Плагин «auth» (core, корневой §7) подключается ОДНОЙ строкой:
 *   provideAuthPlugin({ base: 'http://127.0.0.1:8443/v1/exchange' })
 * — подменить транспорт (HTTP → WebTransport) = заменить на другой
 *   `provideAuthPlugin` (SEAM).
 *
 * URL бэка — одна из «настроек среды»: dev `http://127.0.0.1:8443` (см.
 * server/AGENTS.md); prod — через Caddy reverse proxy, base будет «относительным»
 * `'/v1/exchange'`.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // Signal Forms: status-классы (ng-untouched/ng-dirty/ng-invalid/ng-pending).
    provideSignalFormsConfig({
      classes: {
        'ng-untouched': (b) => !b.state().touched(),
        'ng-valid': (b) => b.state().valid(),
        'ng-invalid': (b) => b.state().invalid(),
      },
    }),
    // Плагин «auth».
    provideAuthPlugin({
      base: 'http://127.0.0.1:8443/v1/exchange',
      timeoutMs: 15000,
      logLevel: 'info',
    }),
  ],
};
