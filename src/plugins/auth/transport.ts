// transport.ts — Контракт транспорта (SEAM) + тип передачи.
//
// Это единственный «шов» между бизнес-логикой и сетью. Смена реализация
// (= sмена HTTP → WebTransport) = смена записи провайдера, код фичи не правится.
//
// Правило: `dispatchEnvelope` — метод с единственным входом/выходом (Envelope
// байты), без «красивых» REST-путей по сторонам. Это та же модель, что у бэка
// (`server/src/transport/transport.js`).

import type { Envelope } from '../../proto-generated/index';

/**
 * Контракт транспорта (SEAM).
 *
 * - `name` — человекочитаемый идентификатор реализации (лог/отладка).
 * - `dispatchEnvelope` — один вызов, один вход, один выход.
 */
export interface ITransport {
  readonly name: string;
  dispatchEnvelope(bytes: Uint8Array): Promise<Uint8Array>;
}
