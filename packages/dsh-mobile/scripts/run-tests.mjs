import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

/**
 * Run every `test/*.test.js` in this process.
 *
 * `node --test` spawns one child per file, which some restricted environments
 * refuse (EPERM on the test runner's IPC pipes). Importing the files keeps the
 * built-in `node:test` reporter and works everywhere the plugin itself runs.
 */
const directory = fileURLToPath(new URL('../test/', import.meta.url));
const files = (await readdir(directory)).filter((file) => file.endsWith('.test.js')).sort();
for (const file of files) {
  await import(pathToFileURL(join(directory, file)).href);
}
