# VoltPOS — how to test this update

## 0. Run it
```
npm install
npm start
```
Open the data folder any time from inside the app: **File → Open Data Folder** (Ctrl/Cmd+Shift+D).
**To start completely fresh:** close VoltPOS, open the data folder, delete everything inside it, start again.

## 1. PIN + recovery code (≈3 min)
1. Fresh start → setup wizard → Step 1 shop name → Step 2 choose an Owner PIN (e.g. 1234).
2. Step 3 shows your **recovery code** (e.g. `K7M2-XQ9R-…`). Tick "I have saved…" → Start.
3. Open the data folder → `RECOVERY.txt` has the same code. `settings.json` has **no** readable PIN.
4. Click 🔒 Lock → the lock screen has a **🔑 Forgot Owner PIN?** button.
5. Click it → enter the code + a new PIN twice → **Reset PIN**. You're logged in as Owner and a **new** code is shown (each code works once).
6. Lock again and log in with the new PIN. The old PIN must fail.
7. Enter a wrong PIN 5 times → "Too many attempts. Try again in 30s."
8. Settings → add Manager and Cashier PINs. Lock → log in as each → confirm tabs match their role.
9. Reinstall test: close the app, delete nothing in the data folder, uninstall/reinstall → PINs still work.

## 2. Setup lock
Fresh start → try to reach the app without finishing the wizard: you can't. "Skip PIN" asks for confirmation and warns the app will be open.

## 3. Guided tour
* First sign-in per role shows "👋 New here?" (bottom-left). **Show me around** = full tour; it also tucks itself away after 25 s.
* ❓ **Tour** (top right) = tour of the page you're on. On its last step, **Next page ▸** continues.
* Keys: → / Enter next, ← back, Esc quit. Log in as Cashier → the tour only covers Dashboard + POS.

## 4. Receipt printing (no more pop-up)
Add a product (Inventory) → sell it (POS → ⚡ Charge) → **🖨 Print Receipt**. The system print dialog must open with **no** "allow pop-ups" message. Choose "Save as PDF" if you have no printer. Also try End of Day → Print.
**Do this on the real shop printer** before handing over (paper width, margins).

## 5. Auto-update (needs the GitHub repo to be PUBLIC)
1. Build/install the current version (3.0.0) on a test PC from the GitHub Actions artifact.
2. Change `"version"` in package.json to `3.0.1`, commit, then:
   `git tag v3.0.1 && git push origin main --tags`
3. Actions builds both installers and creates a **draft** release `v3.0.1` (with `latest.yml`).
4. GitHub → Releases → open the draft → **Publish release**.
5. Open the installed 3.0.0 with internet on. After ~15 s it downloads the update and asks to restart (or use **Help → Check for Updates…**).
   Windows: installs on restart. Mac: until the app is code-signed you'll get a "download the new version" prompt instead.

## 6. Quick regression pass (things I did not change but you should still click)
POS sale (cash + credit) · Mark credit paid · Amend a sale · Restock + stock history · Add expense · Profit report + Best Sellers · Backup → Restore · CSV exports · Light/Dark toggle.

## 7. Categories (new)
Inventory → **🏷 Categories**: add, rename, delete. Renaming updates every product in it; deleting one that has products asks where to move them. In the product form, **＋ New** adds a category on the spot. The list is saved in settings.json and included in backups.

## 8. Sample data (optional)
`voltpos-sample-data.json` = 46 products, 70 sales over a month (incl. 9 unpaid credit sales), 10 customers, 12 expenses, stock history. Load it with **Settings → Restore Backup**. Three products are deliberately sold out and five are low on stock. Sold-out items disappear from the POS screen (by design) but stay in Inventory marked OUT.

## 9. Sold-out products on the POS (changed in 3.2.0)
Products with 0 stock now stay visible on the POS screen, greyed out with "OUT OF STOCK", listed after the in-stock ones. They can't be added to the cart. Before, they silently disappeared, and if every product was at 0 the screen said "No products yet". Adding a product with 0 stock shows a reminder to restock it.

## 10. Remote Dashboard (new in 3.2.0, optional)
Deploy the cloud part once by following `cloud/README.md`. Then per client:
1. `node manage.js create <server-url> <admin-token> "Client" "Password" "Shop 1" "Shop 2"`.
2. In each shop's VoltPOS: Settings → **📡 Remote Dashboard**. Enter server address, account code, shop ID and shop key, tick **Send updates**, press **Save**. You should see "✓ Last update sent".
3. Open the server address on a phone, sign in with the account code and password. You should see the shop(s), today's numbers, recent sales, low stock, who owes money.
4. Make a sale in the shop. Within about 30 seconds it shows on the page (press Refresh).
5. Switch the shop's internet off, make a sale (it must work normally), switch it back on → press **Send update now** and the page catches up.
6. If an Owner PIN is set, only the logged-in Owner can change these settings.
