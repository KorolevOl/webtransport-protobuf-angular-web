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
- **strict** (включён в `ng new`); strict flags — те, что в `tsconfig.json` дефолта (см.
  `tsconfig.json` подрепо).
- **`no` `any`** — при неопределённости — `unknown` + narrowing, а не `any`.
- Имена файлов — **дефисы** (пример: `user-profile.component.ts`, `web-transport-adapter.ts`).
- **БЕЗ** `helpers.ts`/`utils.ts` — каждая функция со своим модулем.

### Логи
- ОДЕН **logger-фасад** — все логи через него (библиотека — на выбор, candidate: `@taiga-ui/kit-logging`
  или свой тонкий слой).
- Критичные пути: вход/выход функций, ветвления решений, запуск внеш. операций (сеть/диск/
  subprocess), обработка ошибок, переходы состояний — **лог обязательный**.
- Код без логов — баг отладочного постафактум.

## Protobuf в `web/`

**Стек**: `@bufbuild/protobuf` (protobuf-es) + `buf` v2 + `protoc-gen-es` (`target=ts`).
**НЕ** `ts-proto`/`protobufjs`/`@protobuf-ts/runtime` (корневой [../AGENTS.md](../AGENTS.md) §2).

**Раскладка**:
```
web/
├── buf.gen.yaml           # v2; plugin protoc-gen-es; out=src/proto-generated; target=ts
├── scripts/
│  ├── clean-proto.js       # rm -rf src/proto-generated
│  └── generate-proto-index.js  # баррел index.ts для src/proto-generated
└── src/proto-generated/    # ВЫВОД — НИКОГДА не редактировать
```

**`buf.gen.yaml` (v2)**:
```yaml
version: v2
plugins:
  - local: protoc-gen-es
    out: src/proto-generated
    opt:
      - target=ts
      - import_extension=none
      # - json_types=true   # если нужен JSON-mapping
```

**Скрипты `package.json`**:
```json
"proto:gen": "node scripts/clean-proto.js && buf generate ../proto && node scripts/generate-proto-index.js"
```

**Зависимости**:
- Runtime: `@bufbuild/protobuf`
- Dev: `@bufbuild/buf`, `@bufbuild/protoc-gen-es`

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
- Файлы-сериализация: protobuf-es в adapter (`Greeting.encode()`/`Greeting.decode()`),
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

## Верификация

- **Яндекс Browser** (= Chromium) — **первичен**; НЕ `chrome.exe`/`msedge.exe`.
- CDP `127.0.0.1:9222`, skill `browser-debug`, debug-профиль `browser-harness-profile`.
- Сценарий: handshake → reliable stream echo → datagram round-trip → close gracefully.
- Secure context: `https://localhost:9443` (см. `certs/AGENTS.md`), WebTransport доступен.

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

# Протубоген (после изменения proto/):
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

- ❌ Не писать `any`. Не писать `standalone: true`/`OnPush` явно.
- ❌ Не тащить `@angular/animations`.
- ❌ Не импортировать исходники `server/` или `proto/` — только сгенерированный код из
  `src/proto-generated/` (вывод кодогена).
- ❌ Не редактировать `src/proto-generated/` — чинить через `.proto` → `npm run proto:gen`.
- ❌ Не размазывать WebTransport-детали (streams/datagrams/backpressure/reconnect) по
  компонентам — только в адаптере.
- ❌ Не писать в stream без учёта `desiredSize`.
- ❌ Не дублировать reconnect в нескольких местах.
- ❌ Не использовать `ts-proto`/`protobufjs`.
- ❌ Не `chrome.exe`/`msedge.exe` для верификации — **Яндекс Browser**.

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
