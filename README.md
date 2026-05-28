# LoRa 3D Map

This project is a Vite-based frontend application for visualizing LoRa activity on a 3D map with dashboard.

## Requirement

- Node.js
- npm

## Install and Run

```
npm install
npm run dev
```

Then open the URL shown in terminal, usually http://localhost:5173.

## How to fix error

### If installation fails on Windows

Windows may fail because `fsevenets` is macOS-only and because npm can sometimes miss Rollup's optional native dependency on Windows.
Delete the current modules and lock file:

```
rm -rf node_modules
rm -f package-lock.json
```

Clean the npm cache and reinstall:

```
npm cache clean --force
npm install --omit=optional
npm install @rollup/rollup-win32-x64-msvc --save-optional
npm run dev
```

### If installation fails on macOS

On macOS, remove the current modules an lock file first:

```
rm -rf node_modules
rm -f package-lock.json
```

Then reinstalls:

```
npm cache clean --force
npm install
npm run dev
```

### If vite is not found

Install `npm install vite --save-dev`.
