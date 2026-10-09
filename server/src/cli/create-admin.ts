import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';

import { loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { UserRepository } from '../user/user.repository.js';
import { UserService } from '../user/user.service.js';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk;
      if (value.length > 4096) throw new Error('Password input is too long');
    }
    return value.replace(/\r?\n$/, '');
  }

  process.stderr.write('Password (minimum 12 characters): ');
  const hiddenOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
  try {
    return await new Promise<string>((resolve) => input.question('', resolve));
  } finally {
    input.close();
    process.stderr.write('\n');
  }
}

const username = process.argv[2];
if (!username || process.argv.length > 3) {
  console.error('Usage: npm run admin -- <username> (or npm run admin:local -- <username>)');
  process.exitCode = 1;
} else {
  const db = createDb(loadConfig(process.env));
  try {
    await new UserService(new UserRepository(db)).createFirstAdmin(username, await readPassword());
    console.log('First admin created.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Admin bootstrap failed');
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
