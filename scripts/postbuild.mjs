import { readFileSync, writeFileSync } from 'node:fs';

const write = (path, value) =>
  writeFileSync(new URL(`../${path}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');

write('dist/esm/package.json', { type: 'module', sideEffects: false });
write('dist/cjs/package.json', { type: 'commonjs', sideEffects: false });

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const dir of ['esm', 'cjs']) {
  const file = new URL(`../dist/${dir}/version.js`, import.meta.url);
  const source = readFileSync(file, 'utf8');
  if (!source.includes(`'${pkg.version}'`) && !source.includes(`"${pkg.version}"`)) {
    throw new Error(`dist/${dir}/version.js does not contain the package version ${pkg.version}`);
  }
}
