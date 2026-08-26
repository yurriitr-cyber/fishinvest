import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const databaseDir = join(process.cwd(), '.data', 'postgres');
const alreadyInit = existsSync(join(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'rarefish',
  password: 'rarefish',
  port: 5432,
  persistent: true,
  onLog: (msg) => process.stdout.write(String(msg)),
  onError: (msg) => console.error(msg),
});

async function main() {
  if (!alreadyInit) {
    console.log('Initialising embedded Postgres…');
    await pg.initialise();
  }

  console.log('Starting embedded Postgres on :5432…');
  await pg.start();

  try {
    await pg.createDatabase('rarefish');
    console.log('Created database rarefish');
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/already exists/i.test(msg)) {
      // reconnect as admin DB if create failed for other reasons
      console.log('createDatabase:', msg);
    } else {
      console.log('Database rarefish already exists');
    }
  }

  console.log('Postgres ready: postgresql://rarefish:rarefish@localhost:5432/rarefish');
  console.log('Keep this process running. Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await pg.stop();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pg.stop();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
