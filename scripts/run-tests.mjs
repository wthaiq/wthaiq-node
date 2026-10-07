import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const suite = process.argv[2] ?? 'unit';
const root = join(process.cwd(), '.test-dist', 'test');
const dir = suite === 'integration' ? join(root, 'integration') : root;

const files = [];
const walk = (current, recurse) => {
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    if (statSync(full).isDirectory()) {
      if (recurse) walk(full, recurse);
    } else if (name.endsWith('.test.js')) {
      files.push(full);
    }
  }
};
walk(dir, suite === 'integration');
files.sort();

if (files.length === 0) {
  console.error(`No ${suite} test files found in ${dir}. Run "tsc -p tsconfig.test.json" first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...files], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
