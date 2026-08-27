// envelope-client.ts — обёртка-метод «один Envelope-запрос → один Envelope-ответ».
//
// Правило контракта (зафиксировано в proto/AGENTS.md + envelope.proto):
// каждая операция = пара `<Base>Request` / `<Base>Response` с общим префиксом.
// `call('refresh', refreshRequestMsg)` сам достаёт:
//   • для отправки  — кейс `refreshRequest`  (base + 'Request'),
//   • для проверки  — кейс `refreshResponse` (base + 'Response'),
// и возвращает ТОЛЬКО типизированное сообщение ответа:
//   Promise<RefreshResponse> — данные ответа на руках; «факт успешности»
//   — в том, что промис разрешился (нет throw = сервер ответил парно).
//
// Типы НЕ перечислены — выводятся из oneof Envelope.payload (envelope-types.ts):
// IDE подсказывает валидные base ('login' | 'register' | 'refresh' | 'logout'),
// чужой base / чужой payload отклоняются на этапе компиляции (no any, §5).
//
// Это ядро Envelope-транспорта, переиспользуемое ЛЮБЫМ плагином (кор. §7:
// shared → core). Бизнес-код пишет `client.call(<base>, <*Request>)`;
// детали (обёртка в Envelope, encode/decode, транспорт, проверка пары) здесь.
// Смена транспорта — замена реализации ITRANSPORT (SEAM, кор. §1/§7).

import { create as pbCreate } from '@bufbuild/protobuf';
import { timestampNow } from '@bufbuild/protobuf/wkt';
import { EnvelopeSchema, type Envelope } from '../../proto-generated/index';
import type { EnvelopeCodec } from '../codec/envelope-codec';
import type { ITransport } from '../transport/transport';
import { appLog } from '../log/logger';
import type { EnvelopeCase, RequestBase, RequestTypeOf, ResponseTypeOf } from './envelope-types';

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
   * отправить `<base>Request` внутри Envelope, дождаться `<base>Response`,
   * вернуть типизированное сообщение ответа `ResponseTypeOf<B>`.
   *
   * Бросает Error, если сервер ответил другим кейсом (нарушение пары).
   *
   * @param base    имя операции, без суффиксов: 'login' | 'register' | 'refresh' | 'logout'
   * @param message сообщение запроса `<base>Request`
   */
  private async run<B extends RequestBase>(
    base: B,
    responseCase: EnvelopeCase,
    t0: number,
    bytes: Uint8Array,
  ): Promise<ResponseTypeOf<B>> {
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

  /** Публичный API: базовая строка + сообщение запроса → типизированное сообщение ответа. */
  call<B extends RequestBase>(base: B, message: RequestTypeOf<B>): Promise<ResponseTypeOf<B>> {
    const requestCase = `${base}Request` as EnvelopeCase;
    const responseCase = `${base}Response` as EnvelopeCase;
    const t0 = Date.now();

    const env = pbCreate(EnvelopeSchema, {
      messageId: messageId(),
      sentAt: timestampNow(),
      protocolVersion: 1,
      payload: { case: requestCase, value: message } as Envelope['payload'],
    });
    const bytes = this.codec.encode(env);

    return this.run(base, responseCase, t0, bytes);
  }
}
