// auth-logger.ts — единый логгер-фасад плагина auth.
//
// Правило workspace (§7 Логирование): ОДИН углубок; лог — на входе/выходе функций,
// ветвлениях решений, внешних операциях (сеть), обработке ошибок, переходах
// состояний. Уровень настраивается БЕЗ правки логики кода — вызовом `authLog.setLevel()`.
//
// Модель видимости та же, что у бэка (model-visible = logged, канон олега 2026-08-24):
// если событие влияет на поведение пользователя — оно залогировано.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let level: LogLevel = 'info';

function logAt(l: LogLevel, scope: string, detail?: unknown): void {
  if (ORDER[l] < ORDER[level]) return;
  const line = `auth/${scope} [${l.toUpperCase()}]`;
  if (detail === undefined) {
    console[l === 'debug' ? 'log' : l](line);
    return;
  }
  console[l === 'debug' ? 'log' : l](line, detail);
}

export const authLog = {
  /** Установить уровень (dev: authLog.setLevel('debug')). */
  setLevel(l: LogLevel): void {
    level = l;
  },
  currentLevel(): LogLevel {
    return level;
  },
  debug(scope: string, detail?: unknown): void {
    logAt('debug', scope, detail);
  },
  info(scope: string, detail?: unknown): void {
    logAt('info', scope, detail);
  },
  warn(scope: string, detail?: unknown): void {
    logAt('warn', scope, detail);
  },
  error(scope: string, detail?: unknown): void {
    logAt('error', scope, detail);
  },
};
