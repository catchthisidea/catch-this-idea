/**
 * scripts/check-syntax.mjs
 *
 * Valida a sintaxe ES Module de todas as Netlify Functions.
 * Usado pelo CI e pelo script `npm run check`.
 *
 * Uso: node scripts/check-syntax.mjs
 */

import { readdir, readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { join } from 'path';

const FUNCTIONS_DIR = 'netlify/functions';

const files = (await readdir(FUNCTIONS_DIR))
  .filter(f => f.endsWith('.js'))
  .sort();

if (files.length === 0) {
  console.log('Nenhuma função encontrada em', FUNCTIONS_DIR);
  process.exit(0);
}

console.log(`\nA validar ${files.length} funções em ${FUNCTIONS_DIR}/\n`);

let errors = 0;

for (const file of files) {
  const filePath = join(FUNCTIONS_DIR, file);
  const code = await readFile(filePath, 'utf8');

  await new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      ['--input-type=module', '--check'],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    );

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', (exitCode) => {
      if (exitCode === 0) {
        console.log(`  ✓  ${file}`);
      } else {
        console.error(`  ✗  ${file}`);
        // Limpar o path "/dev/stdin" das mensagens de erro do Node
        console.error(stderr.replace(/\/dev\/stdin/g, filePath).trimEnd());
        errors++;
      }
      resolve();
    });

    proc.stdin.write(code);
    proc.stdin.end();
  });
}

console.log('');

if (errors > 0) {
  console.error(`${errors} ficheiro(s) com erros de sintaxe.\n`);
  process.exit(1);
} else {
  console.log('Todas as funções têm sintaxe válida.\n');
}
