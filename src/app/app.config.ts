// app.config.ts — Корневой ApplicationConfig.
//
// Плагин «auth» (core, корневой §7) подключается ОДНОЙ строкой:
//   provideAuthPlugin({ transport: { kind: '...', ... } })
//
// Выбор транспорта (SEAM, корневая §7 «плагинная модульность»):
//   • `kind: 'http'`         — браузер fetch → Node:8443 (POST /v1/exchange).
//   • `kind: 'webtransport'` — браузер → Go edge (QUIC/H3) → Node (4B BE length + Envelope).
//     Обязателен (Chromium): pinSha256Hex = SHA-256(leaf-short/ DER-серт) — см. certs/README.md ⭐.
//     URL — IPv4-литерал (`127.0.0.1`), не `localhost`.
//
// URL бэка — одна из «настроек среды»: dev `http://127.0.0.1:8443` /
// `https://127.0.0.1:9443/awp`; prod — Caddy reverse proxy, base «относительный».

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideSignalFormsConfig } from '@angular/forms/signals';

import { routes } from './app.routes';
import { provideAuthPlugin } from '../plugins/auth/auth.plugin';

/**
 * SHA-256 от DER-сертификата `certs/leaf-short/leaf.pem` (короткий ECDSA P-256,
 * 5 дней; SAN `DNS:localhost, IP:127.0.0.1`; подписан `certs/ca/ca.pem`).
 * Обновлять вместе с leaf-short/ (см. certs/README.md «Переиздание»).
 */
const LEAF_SHORT_SHA256_HEX = 'e5ccd324bfe0c1072d4475bd43504195d37aad9595ddd33262ce574f3d18a150';

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
    // Плагин «auth» — транспорт WebTransport (edge QUIC/H3 → Node).
    // Для HTTP-транспорта закомментировать `pinSha256Hex`-блок и переключить на:
    //   { transport: { kind: 'http', base: 'http://127.0.0.1:8443/v1/exchange' } }
    provideAuthPlugin({
      transport: {
        kind: 'webtransport',
        url: 'https://127.0.0.1:9443/awp',
        protocols: ['awp-v1'],
        pinSha256Hex: LEAF_SHORT_SHA256_HEX,
        timeoutMs: 15000,
      },
      logLevel: 'info',
    }),
  ],
};
