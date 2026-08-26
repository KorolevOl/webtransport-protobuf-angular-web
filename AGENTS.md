# AGENTS.md — web/ (репо #2: Angular-приложение)

> Правила конкретного подрепо **`web/`**. Общие workspace-правила (стек, окружение
> хоста, общие Guardrails, общие Definition of Done) — в корневом [../AGENTS.md](../AGENTS.md).
> Приоритет: этот файл + корневой.

## Назначение

**Фронтенд** на Angular 22, общается с бэкендом через WebTransport. Все
protobuf-сообщения сериализует сам, все транспортные детали держит в адаптере.
UI — Taiga UI v5.

## Статус репо

`ng new` уже выполнен (2026-08-26). Git-репо авто-создано, первый коммит «initial commit».
Зависимости — из дефолтов `ng new`. **Ничего не править вручную**, пока не требуется:
сначала — добавить контракты (`proto/`), потом — подключить кодоген, потом — адаптер.

## Stack и правила (Angular 22)

### Фреймворк
- **zoneless** (по умолчанию в `ng new` v22+; `zone.js` **не** должен быть в `package.json`).
- **standalone** — компоненты, без NgModules (дефолт v20+; **не** писать `standalone: true`).
- **OnPush** по умолчанию (v22+); **не** писать `changeDetection: OnPush` явно.
- **signals** — `signal()`, `computed()`, `effect()` (вместо `Subject` + `AsyncPipe` по
  умолчанию).
- **Signal Forms** (вместо `ngModel`/`FormGroup`); без лишних form-control wrapper'ов.
- **lazy loading** для роутов — по умолчанию.
- **Taiga UI v5** — только через secondary entry points; маски — `@maskito/core`; темы —
  CSS custom properties; **БЕЗ** `@angular/animations`.

### TypeScript
Общие TS-правила (strict, no any, дефисы в именах, без helpers/utils) — в
корневом [../AGENTS.md](../AGENTS.md) §7. Конкретные strict-флаги — в `tsconfig.json` подрепо.

### Логи
Общие правила логирования (единый фасад, критичные пути) — в корневом [../AGENTS.md](../AGENTS.md) §7.
В `web/` кандидат — `@taiga-ui/kit-logging` либо свой тонкий слой.

## Protobuf в `web/`

Канон кодогена (protobuf-es, `buf.gen.yaml`, `proto:gen`, зависимости, запрет кодогена
через `ts-proto`/`protobufjs`) — в корневом [../AGENTS.md](../AGENTS.md) §7. Ниже — только то,
что специфично для `web/`: путь вывода.

**Раскладка**:
```
web/
├── buf.gen.yaml           # v2 — общий с server/, см. корневой §7
├── scripts/
│  ├── clean-proto.js       # rm -rf src/proto-generated
│  └── generate-proto-index.js  # баррел index.ts для src/proto-generated
└── src/proto-generated/    # ВЫВОД — НИКОГДА не редактировать
```

> Конфиг `buf.gen.yaml`, скрипт `proto:gen` и зависимости — идентичны `server/`,
> канон — в корневом [../AGENTS.md](../AGENTS.md) §7.

## WebTransport-клиент (SEAM)

Архитектура — **Контракт + Реализация + Потребитель** (тройное обязательство, см. корневой
[../AGENTS.md](../AGENTS.md) §5).

### Контракт
Файл: `src/core/transport/web-transport-client.ts` (интерфейс).
**НЕ содержит** деталей WebTransport — только «что мы умеем».
```ts
export interface WebTransportClient {
  readonly connected: boolean;
  connect(url: string): Promise<void>;
  close(): void;
  sendReliable(bytes: readonly Uint8Array, streamId?: string): Promise<void>;
  sendUnreliable(bytes: readonly Uint8Array): void;
  onReliableMessage(h: (bytes: readonly Uint8Array, streamId?: string) => void): () => void;
  onUnreliableMessage(h: (bytes: readonly Uint8Array) => void): () => void;
  onError(h: (err: unknown) => void): () => void;
  onDisconnect(h: (code: number, reason: string) => void): () => void;
}
```

### Реализация
Файл: `src/core/transport/web-transport-adapter.ts`.
**Единственный** код в `web/`, который знает про `WebTransport` (global API), про
streams, datagrams, backpressure, reconnect, фрейминг и protobuf-сериализацию.

Ключевые правила:
- `new WebTransport(url)` — только здесь.
- Handshake: `await transport.ready` → `sendUnreliable(Greeting.encode(...).finish())` →
  ждать ack → `connected = true`.
- Backpressure: писать в stream **только** когда `writer.desiredSize > 0`;
  иначе буферизовать + log warn.
- Reconnect: `onclose` → **один** lifecycle hook — пересоздать `new WebTransport(url)`
  (максимум N попыток + backoff). **Не дублировать** reconnect в других местах.
- **Фрейминг** байтового потока — только здесь (см. `proto/PROTOCOL.md`).
- Сериализация: protobuf-es в adapter (`Greeting.encode()`/`Greeting.decode()`),
  НЕ в компонентах.

### Потребитель
Файлы: `src/features/...` — компоненты, use-case сервисы; ходят **только** через
интерфейс `WebTransportClient`.
Не знают про `WebTransport`, про bytes, про streams.

### Логи — через единый фасад
- `connect(url)` — вход/выход.
- `transport.ready` resolve — OK.
- Переход состояния (`connecting` → `connected` → `draining` → `terminated`).
- Ошибка — причина (WebTransportError.code + message + `transport.closed`).
- Reconnect attempt N.
- Backpressure: desiredSize = 0 — warning.

## Токен и редирект (своё)

Канон модели взаимодействия (всё через WebTransport, кроме логина/регистрации и
получения токена) — в корневом [../AGENTS.md](../AGENTS.md) §1 «Модель взаимодействия фрон ↔ бэк».

Что специфично для `web/`:
- **Хранение токена** — `sessionStorage` (не `localStorage` — не переживает закрытие
  вкладки) под отдельным ключом; **один** источник, все чтения через один сервис
  `src/core/auth/token-store.ts` (сигнал `currentToken`).
- **Route guard / interceptor**: видит 401/403 → запоминает текущий URL в
  `sessionStorage` (`redirect_after_auth`) → redirect на
  `/login?redirect=<зачищенный-URL>`.
- **После login-успеха** — router navigates на `redirect_after_auth` (или на `?redirect`
  из URL логина), ключ очищается.
- **Логин/регистрация** — через `HttpClient` (это единственное, что ходит по обычной
  HTTP, не WebTransport); **после** получения токена все остальные запросы — только
  `WebTransportClient`.
- **Refresh** — по политикам из `proto/PROTOCOL.md`; в `web/` — отдельный интерцептор
  / сервис, **не** размазанный по компонентам.

## Верификация

- **Яндекс Browser** (= Chromium) — **первичен**; НЕ `chrome.exe`/`msedge.exe`.
- CDP `127.0.0.1:9222`, skill `browser-debug`, debug-профиль `browser-harness-profile`.
- Сценарий: handshake → reliable stream echo → datagram round-trip → close gracefully.
- Secure context: `https://localhost:9443` (см. [certs/AGENTS.md](../certs/AGENTS.md)), WebTransport доступен.

## Команды

```bash
cd web
# Уже сделано: ng new web --zoneless --defaults --style=css --strict --no-ssr --package-manager=npm
# И есть: package.json, node_modules, .git (commit 3d0c8ed)

# Добавить proto-pipeline (один раз):
npm i @bufbuild/protobuf
npm i -D @bufbuild/buf @bufbuild/protoc-gen-es
# Создать: buf.gen.yaml + scripts/clean-proto.js + scripts/generate-proto-index.js
# Скрипт proto:gen в package.json

# Кодоген (после изменения proto/):
npm run proto:gen

# Dev / build / test / lint:
npm run start
npm run build
npm test
npm run lint
```

> Точные флаги scaffold и конфиги (`angular.json`, `tsconfig.json`) — сверять с
> Angular CLI v22 дефолтами. Корневой [../AGENTS.md](../AGENTS.md) §4 — ссылка на корпус документации
> Angular v22.

## Guardrails (свои)

- ❌ Не писать `standalone: true` / `OnPush` явно. Не тащить `@angular/animations`.
- ❌ Не импортировать исходники `server/` или `proto/` — только сгенерированный код из
  `src/proto-generated/` (вывод кодогена). Правило «не редактировать `src/proto-generated/`»
  — общее, см. корневой [../AGENTS.md](../AGENTS.md) §5/§7.
- ❌ Не размазывать WebTransport-детали (streams/datagrams/backpressure/reconnect) по
  компонентам — только в адаптере.
- ❌ Не создавать второй WebTransport рядом с первым — **singleton** на всё приложение
  (см. корневой [../AGENTS.md](../AGENTS.md) §1 «Живой цикл WebTransport (singleton)»).
- ❌ Не писать в stream без учёта `desiredSize`.
- ❌ Не дублировать reconnect в нескольких местах.

## Definition of Done (по `web/`)

- [ ] `buf.gen.yaml` на месте; `scripts/clean-proto.js` и `scripts/generate-proto-index.js`
      работают; `proto:gen` в `package.json` и даёт `src/proto-generated/*.ts`.
- [ ] SEAM в месте реализации: `web-transport-client.ts` (интерфейс) / `web-transport-adapter.ts`
      (реализация) / компоненты (потребители) — разделены.
- [ ] `npm run build` — без ошибок TS (strict, без `any`); `npm run lint` — чисто.
- [ ] Логирование критичных путей (единый logger-фасад).
- [ ] TLS: `certs/` сгенерирован, CA импортирован в хранилище Windows,
      `https://localhost:9443` — secure context в браузере.
- [ ] Верификация транспорта в Яндекс Browser: handshake, reliable stream echo,
      datagram round-trip, graceful close.
