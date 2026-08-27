// envelope-types.ts — «словарь» Envelope: oneof-кейсы + вывод операций Request/Response.
//
// Envelope.payload — дискриминированный union по `case` (codegen v2, oneof):
//   { case: 'loginRequest'; value: LoginRequest }
// | { case: 'loginResponse'; value: LoginResponse }
// | { case: 'registerRequest'; ... } | ...
// Отсюда выводим ВСЁ без ручного перечисления:
//   • все валидные кейсы;
//   • тип сообщения под каждым кейсом;
//   • имена операций (base) + типы их `<base>Request` / `<base>Response`.
// IDE подсказывает только литералы, реально существующие в .proto; при
// добавлении кейса в proto + regen этот файл «расширяется» сам.
//
// Это «контракт/словарь» Envelope-транспорта, общий для всех плагинов
// (корневой §7: shared → core, не монолитить): не auth-бизнес и не
// транспорт-деталь, а только номенклатура oneof + её проекции в типы.

import type { Envelope } from '../../proto-generated/index';

/** Все валидные кейсы Envelope.payload (без unset-варианта `case: undefined`). */
export type EnvelopeCase = Exclude<Envelope['payload']['case'], undefined>;

/** Тип сообщения, лежащего под кейсом C. Выводится из union без перечисления. */
export type EnvelopeValueOf<C extends EnvelopeCase> =
  Extract<Envelope['payload'], { case: C }>['value'];

// --- Механика вывода операций (base) из номенклатуры кейсов ---

// `Record<RequestBase, `${string}Request`>` НЕ РАБОТАЕТ: значение каждого
// ключа становится общим шаблоном `${string}Request` и не сужает до литерала.
// Мapped type над ключами даёт конкретный литерал `${B}Request` на каждый B.

/** base → кейс запроса (например 'login' → 'loginRequest'). */
type RequestCaseOf = { [B in RequestBase]: `${B}Request` };

/** base → кейс ответа (например 'login' → 'loginResponse'). */
type ResponseCaseOf = { [B in RequestBase]: `${B}Response` };

/**
 * Имя операции (base) — кейс запроса минус суффикс `Request`.
 * Входит только base, для которого в oneof есть кейс `<base>Request`.
 * Естественный набор (auth.v1): 'login' | 'register' | 'refresh' | 'logout'.
 */
export type RequestBase = {
  [K in EnvelopeCase as K extends `${infer B}Request` ? (B extends string ? B : never) : never]: unknown;
} extends { [B in infer B]: unknown }
  ? B
  : never;

/** Тип сообщения запроса `${B}Request`. */
export type RequestTypeOf<B extends RequestBase> = EnvelopeValueOf<RequestCaseOf[B]>;

/** Тип сообщения ответа `${B}Response`. */
export type ResponseTypeOf<B extends RequestBase> = EnvelopeValueOf<ResponseCaseOf[B]>;
