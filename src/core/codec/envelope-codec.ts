// envelope-codec.ts — Контракт + реализация кодика Envelope.
//
// Единственная точка фронта, где байты ↔ Envelope. Транспорт не кодирует сам —
// вызывает codec.encode(env) → bytes и codec.decode(bytes) → Envelope.
// Замена wire-формата (если когда-нибудь понадобится) — единственное место для правки.
//
// Это зеркальное копирование серверного `src/codec/envelope-codec.ts` (по канону
// корневой §7: «фрейминг/кодек симметричны в обоих адаптерах»).

import { fromBinary, toBinary, type Message } from '@bufbuild/protobuf';
import { EnvelopeSchema, type Envelope } from '../../proto-generated/index';

/** Контракт кодика (SEAM). */
export interface EnvelopeCodec {
  decode(bytes: Uint8Array): Envelope;
  encode(env: Envelope): Uint8Array;
}

/** Штатная реализация поверх protobuf-es. */
export const protoEnvelopeCodec: EnvelopeCodec = {
  decode(bytes: Uint8Array): Envelope {
    return fromBinary(EnvelopeSchema, bytes) as Message as Envelope;
  },
  encode(env: Envelope): Uint8Array {
    return toBinary(EnvelopeSchema, env);
  },
};
