// Manage client accounts on your deployed remote-dashboard server.
//
//   node manage.js create <server-url> <admin-token> "Client name" "Password (8+ chars)" "Shop 1" ["Shop 2" ...]
//   node manage.js add-shop <server-url> <admin-token> <ACCOUNT> "Shop name"
//   node manage.js reset-password <server-url> <admin-token> <ACCOUNT> "New password (8+ chars)"
//   node manage.js delete <server-url> <admin-token> <ACCOUNT>
//
// The shop keys are shown ONCE. Copy them straight into each shop's Settings -> Remote Dashboard.
const [, , cmd, server, token, ...rest] = process.argv;

async function call(action, body) {
  const r = await fetch(server.replace(/\/+$/, '') + '/api/admin/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin': token },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.error('Failed (' + r.status + '): ' + (j.error || 'unknown error')); process.exit(1); }
  return j;
}
const base = (server || '').replace(/\/+$/, '');

if (cmd === 'create' && server && token && rest.length >= 3) {
  const [name, password, ...shops] = rest;
  const j = await call('account', { name, password, shops });
  console.log(`\nAccount created for "${name}"\n`);
  console.log(`  Owner page:    ${base}`);
  console.log(`  Account code:  ${j.account}`);
  console.log(`  Password:      ${password}\n`);
  for (const s of j.shops) {
    console.log(`  ${s.name}`);
    console.log(`     Server address: ${base}`);
    console.log(`     Account code:   ${j.account}`);
    console.log(`     Shop ID:        ${s.id}`);
    console.log(`     Shop key:       ${s.key}\n`);
  }
  console.log('Keep these safe. The shop keys cannot be shown again.\n');
} else if (cmd === 'add-shop' && server && token && rest.length === 2) {
  const j = await call('shop', { account: rest[0], name: rest[1] });
  console.log(`\nShop added: ${j.shop.name}\n  Shop ID:  ${j.shop.id}\n  Shop key: ${j.shop.key}\n  (account ${j.account}, server ${base})\n`);
} else if (cmd === 'reset-password' && server && token && rest.length === 2) {
  await call('reset-password', { account: rest[0], password: rest[1] });
  console.log('Password changed.');
} else if (cmd === 'delete' && server && token && rest.length === 1) {
  await call('delete-account', { account: rest[0] });
  console.log('Account deleted.');
} else {
  console.log(fs_usage());
}
function fs_usage() {
  return `Usage:
  node manage.js create <server-url> <admin-token> "Client name" "Password" "Shop 1" ["Shop 2" ...]
  node manage.js add-shop <server-url> <admin-token> <ACCOUNT> "Shop name"
  node manage.js reset-password <server-url> <admin-token> <ACCOUNT> "New password"
  node manage.js delete <server-url> <admin-token> <ACCOUNT>`;
}
