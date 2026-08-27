// envelope-client.ts — обёртка-метод «один Envelope-запрос → один Envelope-ответ».
//
// Правило контракта (зафиксировано в proto/AGENTS.md + envelope.proto):
// каждая операция = пара `<Base>Request` / `<Base>Response` с общим префиксом.
// `call('refresh', { refreshToken: … })` сам:
//   • строит сообщение `<base>Request` (pbCreate со схемой из REQUEST_SCHEMAS),
//   • для отправки  — кейс `refreshRequest`  (base + 'Request'),
//   • для проверки  — кейс `refreshResponse` (base + 'Response'),
// и возвращает ТОЛЬКО типизированное сообщение ответа:
//   Promise<RefreshResponse> — данные ответа на руках; «факт успешности»
//   — в том, что промис разрешился (нет throw = сервер ответил парно).
//
// Типы НЕ перечислены — выводятся из oneof Envelope.payload (envelope-types.ts):
// IDE подсказывает валидные base ('login' | 'register' | 'refresh' | 'logout')
// и поля запроса для выбранного base; чужой base / чужой payload отклоняются
// на этапе компиляции (no any, §5).
//
// Это ядро Envelope-транспорта, переиспользуемое ЛЮБЫМ плагином (кор. §7:
// shared → core). Бизнес-код пишет ОДНУ строку:
//   client.call('refresh', { refreshToken })
// детали (создание запроса, обёртка в Envelope, encode/decode, транспорт,
// проверка пары) — здесь. Смена транспорта — замена ITRANSPORT (SEAM, §1/§7).

import { create as pbCreate } from '@bufbuild/protobuf';
import { timestampNow } from '@bufbuild/protobuf/wkt';
import { EnvelopeSchema, type Envelope } from '../../proto-generated/index';
import type { EnvelopeCodec } from '../codec/envelope-codec';
import type { ITransport } from '../transport/transport';
import { appLog } from '../log/logger';
import type { EnvelopeCase, RequestBase, RequestInitOf, ResponseTypeOf } from './envelope-types';
import { REQUEST_SCHEMAS } from './request-schemas';

const log = appLog('envelope');

function messageId(): string {
  return 'web-' + Math.random().toString(36).slice(2, 10);
}

export class EnvelopeClient {
  constructor(
    private readonly codec: EnvelopeCodec,
    private readonly transport: ITransport,
  ) {}

  /**
   * Выполнить операцию `base` (например `'refresh'`):
   * построить и отправить `<base>Request` внутри Envelope, дождаться
   * `<base>Response`, вернуть типизированное сообщение ответа.
   *
   * `pbCreate` + проверка пары скрыты внутри: вызывающий пишет ОДНУ строку —
   * `client.call('refresh', { refreshToken })` — без ручного создания
   * запроса и без `expectCase`.
   *
   * Бросает Error, если сервер ответил другим кейсом (нарушение пары).
   *
   * @param base   имя операции, без суффиксов: 'login' | 'register' | 'refresh' | 'logout'
   * @param init   обычный объект-инициализация `<base>Request` (поля опциональны)
   */
  async call<B extends RequestBase>(base: B, init?: RequestInitOf<B>): Promise<ResponseTypeOf<B>> {
    const requestCase = `${base}Request` as EnvelopeCase;
    const responseCase = `${base}Response` as EnvelopeCase;
    const t0 = Date.now();
    // Мост (единственный cast в core/): runtime-карта хранит widened
    // DescMessage, а MessageInitShape<конкретная схема> — deferred-тип,
    // неразрешимый для общего ключа. Публичный init уже верифицирован
    // сигнатурой call() — здесь только граница «типизированный вход →
    // динамический desc».
    const desc = REQUEST_SCHEMAS[base];
    const message = pbCreate(desc, (init ?? {}) as never);

    const env = pbCreate(EnvelopeSchema, {
      messageId: messageId(),
      sentAt: timestampNow(),
      protocolVersion: 1,
      payload: { case: requestCase, value: message } as Envelope['payload'],
    });
    const bytes = this.codec.encode(env);

    try {
      const raw = await this.transport.dispatchEnvelope(bytes);
      const resp = this.codec.decode(raw);
      if (resp.payload.case !== responseCase) {
        log.error(`call(${base}): unexpected case`, { got: resp.payload.case, expected: responseCase });
        throw new Error(`expected ${responseCase}, got ${resp.payload.case}`);
      }
      return resp.payload.value as ResponseTypeOf<B>;
    } finally {
      log.debug('call', { base, ms: Date.now() - t0, bytes: bytes.byteLength });
    }
  }
}
