import { createRequire } from 'node:module';
const require = createRequire('L:/ms06/ms06/MS06-Clone-Platform/apps/identity-service/');
const argon2 = require('argon2');
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://fleetvision:fleetvision@localhost:15432/fleetvision',
});
await client.connect();
const r = await client.query(
  "SELECT key_hash, status, expires_at FROM iam.api_keys WHERE key_prefix = 'fv_live_3Go'",
);
console.log('rows:', r.rowCount);
if (r.rowCount > 0) {
  console.log(
    'verify:',
    await argon2.verify(r.rows[0].key_hash, 'fv_live_3GosfKEKh4EHmj9-1WFmO_fjZXwrkXek'),
  );
  console.log('status:', r.rows[0].status, 'expires:', r.rows[0].expires_at);
}
await client.end();
