// request-schemas.ts — base → <Base>Request runtime-дескриптор (core shared).
//
// АВТО-ПРОИЗВОДСТВО из сгенерированного oneof (EnvelopeSchema.oneofs):
// ноль ручного обслуживания. Новый домен в .proto → `npm run proto:gen` →
// модуль просто работает (каждое поле oneof несёт в себе DescMessage).
//
// Тип-уровень (IDE-подсказки по полям init) — RequestInitOf<B> из
// envelope-types.ts (Partial<тип сообщения> — имена/типы из .proto).

import type { DescMessage } from '@bufbuild/protobuf';
import { EnvelopeSchema } from '../../proto-generated/index';
import type { RequestBase } from './envelope-types';

/**
 * Сборка карты «base → <Base>Request descriptor» из generated oneof.
 * Критерий: поле-мессендж, localName заканчивается на «Request».
 * (Правило пар из proto/AGENTS.md гарантирует, что такие поля — ровно
 * операции; `Response`-поля отфильтрованы суффиксом.)
 */
function deriveFromOneof(): Record<string, DescMessage> {
  const map: Record<string, DescMessage> = {};
  for (const oneof of EnvelopeSchema.oneofs) {
    for (const field of oneof.fields) {
      const name = field.localName;
      if (field.message !== undefined && name.endsWith('Request')) {
        map[name.slice(0, -'Request'.length)] = field.message;
      }
    }
  }
  return map;
}

/**
 * Единый runtime-реестр base → схема `<Base>Request`.
 * Построен один раз при загрузке; покрывает ВСЕ base из oneof
 * (RequestBase выведен из того же oneof — расхождения невозможны).
 */
export const REQUEST_SCHEMAS: Record<RequestBase, DescMessage> =
  deriveFromOneof() as Record<RequestBase, DescMessage>;
