// web-transport-adapter.ts — Реализация ITransport (SEAM) на WebTransport (H3/QUIC).
//
// Контекст (корневая AGENTS.md §1 + §5, webtransport-protobuf-angular-web/AGENTS.md «WebTransport-клиент (SEAM)»):
//   браузер ⇄ [Go edge: H3/QUIC, ALPN h3] ⇄ локальный TCP ⇄ Node (бизнес).
// Единственный файл, кто знает про:
//   • global `WebTransport` API,
//   • bidi-stream на обмен (1 stream = 1 request → 1 response),
//   • фрейминг 4B BE length + payload (PROTOCOL.md §2; зеркалит
//     webtransport-protobuf-nodejs-server/src/plugins/transport-wt-edge/framing.ts и Go edge),
//   • переподключение при мёртвой сессии (корневая §1),
//   • Chromium-требования (см. webtransport-protobuf-certs/README.md ⭐):
//     (a) `serverCertificateHashes` (pinning) — Chrome WebTransport НЕ читает
//         CA из Windows trust store;
//     (b) pinned-certificate — ECDSA P-256 + срок <~14 дней (leaf-short/);
//     (c) IPv4-литерал в URL (https://127.0.0.1:9443/awp), не `localhost`
//         (localhost → ::1, QUIC-SYN в закрытый IPv6-порт).
//
// Потребители знают только ITransport (dispatchEnvelope: bytes → bytes).
// Замена на HTTP = другой провайдер ITRANSPORT (auth.plugin.ts: `transport.kind`).
//
// Сессия — singleton на всё приложение (корневая §1 «Живой цикл WebTransport»):
// ленивое подключение при первом обмене; при закрытии (idle/сбой) следующий
// dispatch сам поднимает новую сессию (token жив — по канону).

import type { ITransport } from './transport';
import { appLog } from '../log/logger';

const log = appLog('transport-wt');

/** Максимальный размер одного фрейма (payload без 4B len) — зеркалит webtransport-protobuf-nodejs-server/§2. */
const MAX_FRAME = 64 * 1024;

/**
 * Типы lib.dom (TS 6.0) дают `WebTransport` без `readyState`/`protocol` и
 * `WebTransportHash.value: BufferSource` (в TS 6 — `ArrayBufferView<ArrayBuffer>`).
 * Объявляем локально только то, чего нет в lib.dom.
 */
type WTAny = WebTransport & {
  readonly protocol?: string;
};
type BufferSource2 = ArrayBufferView<ArrayBuffer>;

export interface WebTransportAdapterConfig {
  /** Endpoint WebTransport (dev: `https://127.0.0.1:9443/awp`). IPv4-литерал! */
  readonly url: string;
  /** ALPN-протокол(ы). Дефолт — `awp-v1`. */
  readonly protocols?: readonly string[];
  /**
   * SHA-256 от DER leaf-сертификата в hex (64 hex-символа).
   * Обязателен для Chromium (serverCertificateHashes); см. webtransport-protobuf-certs/README.md ⭐.
   */
  readonly pinSha256Hex?: string;
  /** Таймаут одного обмена (request → response), мс. Дефолт 15 000. */
  readonly timeoutMs?: number;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  const h = hex.replace(/\s+/g, '');
  if (h.length !== 64) return null;
  const buf = new ArrayBuffer(32);
  const out = new Uint8Array(buf);
  for (let i = 0; i < 32; i++) {
    const byte = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i] = byte;
  }
  return out;
}

/** Обёртка: 4B BE length + payload (PROTOCOL.md §2; зеркалит framing.ts). */
function framePayload(payload: Uint8Array): Uint8Array {
  if (payload.byteLength > MAX_FRAME) {
    throw new Error(`webtransport: payload ${payload.byteLength} > MAX_FRAME ${MAX_FRAME}`);
  }
  const out = new Uint8Array(4 + payload.byteLength);
  const v = payload.byteLength;
  out[0] = (v >>> 24) & 0xff;
  out[1] = (v >>> 16) & 0xff;
  out[2] = (v >>> 8) & 0xff;
  out[3] = v & 0xff;
  out.set(payload, 4);
  return out;
}

/** До EOF bidi-stream'а собрать весь буфер; извлечь ОДИН фрейм (4B len + payload). */
async function readResponse(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        parts.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.byteLength;
  }
  if (buf.byteLength < 4) {
    throw new Error(`webtransport: response too short (${buf.byteLength} < 4 — нет length-prefix)`);
  }
  const len = (buf[0]! << 24 | buf[1]! << 16 | buf[2]! << 8 | buf[3]!) >>> 0;
  if (len === 0) throw new Error('webtransport: empty frame (length=0) — protocol error');
  if (len > MAX_FRAME) throw new Error(`webtransport: frame too large: ${len} > ${MAX_FRAME}`);
  if (buf.byteLength < 4 + len) {
    throw new Error(`webtransport: response shorter than declared (${buf.byteLength} < ${4 + len})`);
  }
  if (buf.byteLength > 4 + len) {
    log.warn('extra-bytes-after-frame', { got: buf.byteLength, expected: 4 + len });
  }
  return buf.subarray(4, 4 + len);
}

export class WebTransportAdapter implements ITransport {
  readonly name = 'webtransport/envelope';

  private readonly url: string;
  private readonly protocols: readonly string[];
  private readonly timeoutMs: number;
  private readonly certificateHashes: WebTransportHash[] | undefined;

  private session: WebTransport | null = null;
  private connectPromise: Promise<WebTransport> | null = null;
  private closing = false;

  // Teardown (§7 «свой lifecycle и teardown»): на pagehide — graceful close,
  // чтобы не держать висящий QUIC-канал после закрытия вкладки.
  private readonly onPageHide = (): void => {
    void this.close();
  };

  constructor(config: WebTransportAdapterConfig) {
    this.url = config.url;
    this.protocols = config.protocols ?? ['awp-v1'];
    this.timeoutMs = config.timeoutMs ?? 15000;
    if (config.pinSha256Hex) {
      const bytes = hexToBytes(config.pinSha256Hex);
      if (!bytes) {
        log.error('bad-pinSha256Hex', { expected: '64 hex chars', got: config.pinSha256Hex.length });
        throw new Error(`webtransport: pinSha256Hex invalid (need 64 hex chars, got ${config.pinSha256Hex.length})`);
      }
      this.certificateHashes = [{ algorithm: 'sha-256', value: bytes as BufferSource2 as BufferSource }];
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
    }
  }

  /**
   * Ленивое подключение; повторный connect при мёртвой сессии (корневая §1).
   *
   * «Жив ли?» не спрашиваем (lib.dom TS 6.0 не даёт `readyState`): используем
   * retry-on-failure — если exchange упал и сессия «наша», сбрасываем и
   * пробуем ещё РАЗО (новая сессия). Это покрывает и idle-timeout edge (120s),
   * и мёртвый edge, и нормальные повторные вызовы.
   */
  private ensureSession(): Promise<WebTransport> {
    if (this.closing) return Promise.reject(new Error('webtransport: adapter is closing'));
    if (this.connectPromise) return this.connectPromise;
    if (this.session) return Promise.resolve(this.session);
    const t0 = performance.now();
    log.info('connect', { url: this.url, protocols: [...this.protocols], pinning: this.certificateHashes != null });
    const options: WebTransportOptions = { protocols: [...this.protocols] };
    if (this.certificateHashes) options.serverCertificateHashes = this.certificateHashes;

    const p = (async () => {
      const wt = new WebTransport(this.url, options);
      await wt.ready;
      if (this.closing) {
        try { wt.close(); } catch { /* ignore */ }
        throw new Error('webtransport: adapter closed during handshake');
      }
      this.session = wt;
      // Наблюдение за закрытием сессии (lib.dom: `.closed` — Promise; нет `.addEventListener`).
      void wt.closed.then((info) => {
        log.warn('session-closed', { closeCode: info.closeCode ?? 0, reason: info.reason ?? '(none)' });
        if (this.session === wt) this.session = null;
      }).catch(() => { /* close error уже surfaced через dispatch */ });
      log.info('ready', {
        ms: Math.round(performance.now() - t0),
        protocol: (wt as unknown as { protocol?: string }).protocol ?? '(n/a)',
      });
      return wt;
    })();
    this.connectPromise = p;
    return p.finally(() => { this.connectPromise = null; });
  }

  async dispatchEnvelope(bytes: Uint8Array): Promise<Uint8Array> {
    let wt = await this.ensureSession();
    try {
      return await this.exchange(wt, bytes);
    } catch (err) {
      // Сессия мертва (idle-таймаут edge / мёртвый edge) — сбрасываем и
      // ОДИН раз повторяем на новой сессии (corневая §1: «токен жив → переподключиться»).
      if (this.session === wt) {
        log.warn('exchange-failed: reconnect+retry', { err: err instanceof Error ? err.message : String(err) });
        this.session = null;
        wt = await this.ensureSession();
        return await this.exchange(wt, bytes);
      }
      throw err;
    }
  }

  /** Один обмен: 1 bidi-stream (1 request → 1 response) — зеркалит webtransport-protobuf-nodejs-server/§2 + edge. */
  private async exchange(wt: WebTransport, bytes: Uint8Array): Promise<Uint8Array> {
    const t0 = performance.now();
    const stream = await wt.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutErr = new Error(`webtransport: exchange timeout after ${this.timeoutMs} ms`);
    try {
      const result = await Promise.race([
        (async () => {
          await writer.write(framePayload(bytes));
          await writer.close();
          return readResponse(stream.readable);
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeoutErr), this.timeoutMs);
        }),
      ]);
      log.debug('exchange', {
        reqBytes: bytes.byteLength,
        respBytes: result.byteLength,
        ms: Math.round(performance.now() - t0),
      });
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      try { await writer.abort('client-exchange-error'); } catch { /* already closed */ }
    }
  }

  /** Graceful close: teardown сессии + снятие pagehide-обработчика (§7). */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    log.info('close');
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    const s = this.session;
    this.session = null;
    if (s) {
      try { s.close(); } catch { /* already closing */ }
    }
  }
}
