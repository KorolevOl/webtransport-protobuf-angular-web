#!/usr/bin/env node
// clean-proto.js — чистит src/proto-generated/ перед buf generate.
//
// Почему: `buf generate` НЕ удаляет файлы, которых больше нет в исходнике
// (например, `.proto` вырезали, но его `_pb.ts` остался). Если не чистить —
// stale-файлы попадают в сборку и ломают импорт/типизацию.
//
// Как работает:
//  1. Находит src/proto-generated/ (relative to repo root).
//  2. Если есть — рекурсивно удаляет ВСЁ внутри (кроме самой папки).
//  3. Если нет — mkdir (чтобы следующий шаг имел каталог).
//
// Без внешних зависимостей. Только fs, path.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const target = path.join(repoRoot, 'src', 'proto-generated');

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[clean-proto] removed ${path.relative(repoRoot, target)}/`);
}
fs.mkdirSync(target, { recursive: true });
console.log(`[clean-proto] ensured ${path.relative(repoRoot, target)}/ exists`);
