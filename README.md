# ⚡ VoltPOS

A fully offline Point of Sale system for small and medium retail businesses.

## Download

Go to [Actions](../../actions) → click the latest build → download **VoltPOS-Mac** or **VoltPOS-Windows**.

Or go to [Releases](../../releases) for versioned builds.

## Features

- 🛒 Point of Sale with cart, discounts, receipts
- 📦 Inventory with stock history
- 👥 Customer database with purchase history  
- 💳 Credit sales tracking
- 💸 Expense logging
- 💰 Profit & Reports with best sellers
- 🔒 Role-based PIN lock (Cashier / Manager / Owner)
- 📋 End of Day reports
- 100% offline — data stored locally

## Building

Builds are automated via GitHub Actions on every push to main.

To trigger a build manually:
1. Go to Actions tab
2. Click Build VoltPOS Installers  
3. Click Run workflow

To create a release with downloadable files, push a version tag:
```
git tag v3.0.0
git push origin v3.0.0
```

## Development

```
npm install
npm start
```

## Data Location

- Mac: ~/Library/Application Support/VoltPOS/data/
- Windows: %APPDATA%\VoltPOS\data\
