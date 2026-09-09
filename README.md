# Jotly — Notes & Docs 📝

A fast, installable word processor and notes app for phone and tablet, styled after quick-commerce apps like Blinkit and Zepto (bold yellow + violet, rounded cards, bottom-sheet menus). Pure HTML/CSS/JS — no build step, no framework, no paid services. Works offline as a PWA.

## Features

- **Rich text editing** — bold, italic, underline, strikethrough, headings (H1–H3), block quotes, code blocks
- **Fonts** — 4 font families, 7 sizes, text color + highlight color pickers
- **Lists** — bullet, numbered, and tap-to-check checklists
- **Tables** — insert with a visual row × column picker
- **Images** — insert from your device's camera roll / files (stored inline as data URLs)
- **Links, dividers, page breaks**
- **Alignment & indentation**
- **Undo / redo**, **find & replace**, live word/character count
- **Multiple documents** — searchable home screen with document cards, starring, trash/restore
- **Autosave** — everything saved to on-device storage as you type, no account needed
- **Export** — Word (`.docx`, built from scratch — no library), PDF (via print), and plain text (`.txt`)
- **Installable PWA** — "Add to Home Screen" on iOS/Android, works fully offline after first load
- **Blinkit/Zepto-inspired UI** — punchy yellow + violet palette, rounded cards, bottom-sheet toolbars, floating action button

## Project structure

```
jotly/
├── index.html         Home screen + editor screen markup
├── style.css           Design system & layout
├── app.js               App logic: storage, editor commands, UI
├── docx-export.js  Dependency-free .docx (OOXML) generator
├── manifest.json    PWA manifest
├── sw.js                  Offline service worker
└── icons/                App icons
```

## Run it locally

Any static file server works — the app needs no backend and no build step.

```bash
cd jotly
python3 -m http.server 8080
# then open http://localhost:8080 on your phone/computer
```

## Deploy to GitHub Pages

1. Create a new GitHub repo and push this folder's contents to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`, choose the `main` branch and `/ (root)` folder, then **Save**.
4. GitHub will give you a URL like `https://<your-username>.github.io/<repo-name>/`.
5. Open that URL on your phone and tap **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: ⋮ menu → Add to Home Screen / Install app) to use it like a native app.

```bash
git init
git add .
git commit -m "Jotly: notes & docs app"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

## Notes & honest limitations

This isn't a pixel-for-pixel clone of Microsoft Word — that's realistically a decades-in-the-making product. What it does cover is the everyday word-processing toolkit: formatting, lists, tables, images, export to a real `.docx` Word can open, and offline notes. Not included: macros/VBA, real-time multi-user collaboration, mail merge, and advanced citation/reference tooling. The `.docx` export handles text formatting, headings, lists, and tables; images inside the editor aren't yet carried into the exported Word file (they do export fine to PDF).

Everything is stored locally in the browser (`localStorage`) — there's no server and no account, so data doesn't sync between devices unless you add that yourself.
