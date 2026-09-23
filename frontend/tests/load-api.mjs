import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
}).outputText).toString('base64');
const source = await readFile(new URL('../src/shared/api/client.ts', import.meta.url), 'utf8');
// A legacy local .env must never turn production requests into synthetic successes.
const client = compile(source.replaceAll('import.meta.env', JSON.stringify({ VITE_API_BASE_URL: '/api', VITE_USE_MOCK: 'true' })));
export async function loadApi(name) {
  if (name === 'client') return import(client);
  const source = await readFile(new URL(`../src/shared/api/${name}.ts`, import.meta.url), 'utf8');
  return import(compile(source.replace("from './client'", `from '${client}'`)));
}
