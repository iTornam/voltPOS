# VoltPOS Remote Dashboard: setup guide

This lets an owner open **one web page on his phone** and see how his shop(s) are doing: today's sales and profit, cash vs MoMo, who owes money, low stock, best sellers, recent sales and expenses. With two or more shops he sees each shop and the combined totals.

```
 Shop PC (VoltPOS)  ──sends a small snapshot when online──▶  Cloudflare Worker  ◀── owner's phone (login)
   still 100% offline-capable                                  (you deploy this once)
```

* The shop **keeps working with no internet**. It sends a snapshot about 30 seconds after any sale/stock/expense change, and every 20 minutes while the app is open. If the internet is down it simply catches up later.
* **What is sent:** totals, every sale from the last 7 days (customer name, items sold, amount, payment type), stock levels, top products, recent expenses, credit owed per customer name.
* **What is never sent:** PINs, recovery codes, customer phone numbers, the full customer list, or the full sales/product database.
* The page is not "live to the second". It is as fresh as the last update (a coloured dot shows how fresh: green is under 45 min).

## What the owner sees
* **Needs attention** strip at the top: shops that haven't updated for 3+ hours, sold-out and low-stock products, and unpaid credit.
* **Today** cards: revenue (with yesterday's total and a ▲/▼ change), profit, cash, MoMo/card, expenses, credit owed.
* **Sales: last 7 days** — every sale, grouped by day with each day's total. Tap a sale to see what was sold (item, quantity, line total, discount). Search by customer or product. If a shop sells more than 400 in a week, the page says it is showing the latest 400.
* **Last 7 and 30 days**, a **14-day chart** (tap a bar to see that day), best sellers, who owes money, and recent expenses.
* **Hide profit** button (remembers the choice), automatic light/dark mode, and an icon so it can be added to the phone's home screen.
* It is **view-only**. Nothing can be changed from the page.

## One-time setup (you do this once for ALL your clients)

You need a free Cloudflare account (https://dash.cloudflare.com/sign-up, no card needed) and Node.js on your computer.

```bash
cd cloud
npm install                                 # installs wrangler (Cloudflare's tool)
npx wrangler login                          # opens the browser to sign in
npx wrangler kv namespace create VOLT       # prints:  id = "abc123..."
```

1. Open `wrangler.toml` and paste that id in place of `PASTE_KV_NAMESPACE_ID_HERE`.
2. Make a long random admin password and save it somewhere safe (a password manager):
   ```bash
   openssl rand -hex 24
   ```
3. Give it to Cloudflare as a secret (it asks you to paste it):
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
   It prints your address, like `https://voltpos-remote.yourname.workers.dev`. Open it in a browser. You should see the sign-in page.

(If you ever edit `viewer.html` or `worker.src.js`, run `node build.js` first. `npm run deploy` does that for you.)

## For each new client

Create their account (shows the keys **once**):

```bash
node manage.js create https://voltpos-remote.yourname.workers.dev  YOUR_ADMIN_TOKEN \
     "Kofi Stores" "A-good-password" "Accra Shop" "Kumasi Shop"
```

It prints the owner page address, account code and password, plus a **server address, account code, shop ID and shop key for each shop**.

1. **At each shop:** VoltPOS → Settings → **📡 Remote Dashboard**. Type in the four values, tick **Send updates**, press **Save**. It sends straight away and shows "✓ Last update sent".
2. **Give the owner:** the page address, the account code and the password. He bookmarks the page on his phone. (On Android/iPhone: browser menu → "Add to Home screen".)

Other commands:
```bash
node manage.js add-shop       <url> <ADMIN_TOKEN> <ACCOUNT> "New Shop"      # adds a shop, prints its key
node manage.js reset-password <url> <ADMIN_TOKEN> <ACCOUNT> "New password"  # forgotten password
node manage.js delete         <url> <ADMIN_TOKEN> <ACCOUNT>                 # removes the account and its data
```

## Costs and limits (Cloudflare free plan; check current limits on their pricing page)

* Free plan allows roughly **1,000 data writes per day for the whole account**. Each shop uses roughly 100 to 150 a day, so the free plan comfortably covers **about 5 to 8 shops**. Beyond that, Cloudflare's paid plan is about **US$5 per month** and removes the limit.
* If a shop stops updating, the dot on the owner page turns amber, then red. Common reasons: the shop PC is off, VoltPOS is closed, or there's no internet.

## Security notes

* Everything goes over HTTPS. Passwords are stored hashed (PBKDF2), shop keys are stored hashed, and 8 wrong passwords lock the account for 15 minutes.
* A shop key can only send data for **its own shop**. It cannot read anything.
* Anyone who has the owner's account code and password can see that business's numbers, so tell owners not to share them.
* The shop key is stored in `settings.json` on the shop PC (needed to send). Anyone with access to that folder could send fake numbers for that one shop, but could not read anything. Use **Settings → Remove** in the app, or `manage.js add-shop`, to replace a key.
* Tell each client in writing what is sent (see top of this file) and that it is stored on Cloudflare's servers. Some owners will want to know this.

## Troubleshooting

| Message in the shop app | What it means |
|---|---|
| "Server address must start with https://" | Paste the full address from `wrangler deploy` |
| "The server rejected the account code, shop ID or shop key" | A typo. Check each value against what `manage.js` printed. If a key is lost, run `add-shop` for a new one |
| "Could not reach the server" | No internet right now. It retries automatically |
| Owner page: "Wrong account code or password" | Check the code and password. After 8 failures wait 15 minutes, or `reset-password` |
| Owner page: "Waiting for the first update" | The shop hasn't sent anything yet. Open Settings in that shop and press **Send update now** |
