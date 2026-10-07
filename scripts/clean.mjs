import { rmSync } from 'node:fs';

const targets = process.argv.slice(2);
for (const target of targets.length > 0 ? targets : ['dist', '.test-dist', 'coverage']) {
  rmSync(new URL(`../${target}`, import.meta.url), { recursive: true, force: true });
}
