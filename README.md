# ChatGPT Answer TOC Bookmarks

Save table-of-contents bookmarks for ChatGPT answers and jump back instantly. This repo also includes a Bun-based server entry point for future plugin-related APIs.

## Features
- Create bookmarks from selected text via the right-click menu.
- View and jump to saved points from the in-page TOC panel.
- Keep bookmarks locally per conversation.

## Project Structure
- `index.ts` - Bun entry point.
- `extension/` - Browser extension code (content scripts, background worker, assets).

## Development
Install dependencies:

```bash
bun install
```

Run the Bun entry point:

```bash
bun run index.ts
```

Load the extension in Chrome:
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select `extension/`.

## Naming
This project is named after its core feature: a table-of-contents bookmark list for ChatGPT answers.

## License
GPL-3.0-only. See `LICENSE`.
