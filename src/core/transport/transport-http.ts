// transport-http.ts — Реализация ITransport на браузерном fetch + Envelope.
//
// Метод: POST {base}/v1/exchange, body = Envelope bytes, Content-Type = application/octet-stream.
// Это не REST — это «один endpoint, case внутри Envelope — дискриминатор» (канон §1).
//
// У сервера (Node) это же делает `http-transport.ts`. Замена на WebTransport-реализация
// = смена провайдера в `app.config.ts` (SEAM); код выше не трогается.
//
// core/*-слой: общие транспортные швы приложения (не владеет плагину `auth`).

import { inject } from '@angular/core';
import { ITRANSPORT, type ITransport } from './transport';
import { appLog } from '../log/logger';

// Re-export: старые импорты `from './transport-http'` продолжают работать
// без изменения (транспортный SEAM-токен теперь живёт в `transport.ts`,
// и мы его re-экспортируем здесь).
export { ITRANSPORT } from './transport';

const log = appLog('transport');

/**
 * HTTP-реализация: единственный «шов», через который все бизнес-запросы
 * фронте ходят в бек.
 *
 * - `base` — URL endpoint'а (dev: `http://127.0.0.1:8443/v1/exchange`).
 * - `timeout` — дефолт 15 с (auth — мгновенные, но не бесконечно).
 */
export class HttpTransport implements ITransport {
  readonly name = 'http/envelope';

  constructor(
    private readonly base: string,
    private readonly timeoutMs: number = 15000,
  ) {}

  async dispatchEnvelope(bytes: Uint8Array): Promise<Uint8Array> {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.base, {
        method: 'POST',
        body: bytes as unknown as BodyInit,
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.warn('http-error', { status: res.status, body: text.slice(0, 200) });
        throw new Error(`HTTP ${res.status} ${text}`);
      }
      const buf = await res.arrayBuffer();
      const dt = Date.now() - t0;
      log.debug('dispatch', { status: res.status, bytes: bytes.byteLength, ms: dt });
      return new Uint8Array(buf);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Проводник: из DI достаёт ITransport (унифицированный способ потребления SEAM). */
export function injectTransport(): ITransport {
  return inject(ITRANSPORT);
}
