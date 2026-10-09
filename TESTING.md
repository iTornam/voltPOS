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
