# Electron + React + Vite desktop app

A minimal Electron desktop app powered by React and Vite. It shows a welcome message: "Hello im a desktop app".

## Prerequisites

- Node.js 18+
- npm

## Scripts

- `npm install` – install dependencies
- `npm run dev` – start Vite dev server and Electron together
- `npm run build` – bundle the renderer (production assets land in `dist`)
- `npm start` – launch Electron loading the built renderer

## Development

1. Install dependencies: `npm install`.
2. Run `npm run dev`. Wait for the Vite server (http://localhost:5173), then Electron opens the window.

## Packaging (Windows)

This project is wired for electron-builder (Windows target). To produce an installer, install dependencies then run your preferred packaging command (e.g., `npx electron-builder --win`).

## Project structure

- `src/main` – Electron main process
- `src/preload` – preload bridge (currently empty)
- `src/renderer` – Vite + React renderer
