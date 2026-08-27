// logger.ts — единственный логгер-фасад приложения (workspace §7 «Логирование»).
//
// ОДИН углубок: все слои (core/* и plugins/*) логгируют через `appLog(scope)`.
// Лог — на входе/выходе функций, ветвлениях решений, внешних операциях (сеть),
// обработке ошибок, переходах состояний. Уровень настраивается БЕЗ правки логики:
// `setLogLevel('debug')` (один вызов управляет всеми скоупами).
//
// Модель видимости (канон олега 2026-08-24): если событие влияет на поведение
// пользователя — оно залогировано.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let level: LogLevel = 'info';

function consoleFn(l: LogLevel): typeof console.log {
  return l === 'debug' ? console.log : console[l];
}

function logAt(l: LogLevel, line: string, detail?: unknown): void {
  if (ORDER[l] < ORDER[level]) return;
  const fn = consoleFn(l);
  if (detail === undefined) {
    fn(line);
    return;
  }
  fn(line, detail);
}

export interface Logger {
  /** Установить ГЛОБАЛЬНЫЙ уровень (dev: `setLogLevel('debug')`). */
  setLevel(l: LogLevel): void;
  debug(msg: string, detail?: unknown): void;
  info(msg: string, detail?: unknown): void;
  warn(msg: string, detail?: unknown): void;
  error(msg: string, detail?: unknown): void;
}

/** Scoped-логгер: `appLog('auth').info('login', {...})` → `auth/login [INFO]`. */
export function appLog(scope: string): Logger {
  const lineFor = (msg: string): string =>
    msg === '' ? scope : `${scope}/${msg}`;
  return {
    setLevel: (l: LogLevel) => { level = l; },
    debug: (m, d) => logAt('debug', lineFor(m), d),
    info: (m, d) => logAt('info', lineFor(m), d),
    warn: (m, d) => logAt('warn', lineFor(m), d),
    error: (m, d) => logAt('error', lineFor(m), d),
  };
}

export function setLogLevel(l: LogLevel): void {
  level = l;
}

export function getLogLevel(): LogLevel {
  return level;
}
