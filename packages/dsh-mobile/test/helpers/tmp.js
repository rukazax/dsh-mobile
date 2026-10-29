import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The sandbox denies writes to the platform temp directory in some sessions,
 * so tests create their scratch space inside the package instead.
 */
const ROOT = fileURLToPath(new URL('../.tmp/', import.meta.url));

/**
 * @param {string} prefix
 * @returns {Promise<string>}
 */
export async function makeTmp(prefix) {
  const dir = join(ROOT, `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} dir
 */
export async function removeTmp(dir) {
  await rm(dir, { recursive: true, force: true });
}
