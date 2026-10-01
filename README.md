# Jotly — Notes & Docs 📝

A fast, installable word processor for phone and tablet, styled after quick-commerce apps like Blinkit and Zepto (bold yellow + violet, rounded cards, bottom-sheet menus). Pure HTML/CSS/JS — no build step, no framework, no paid services. Works offline as a PWA.

Documents work like MS Word — flowing rich text, headings, lists, tables — with a layer of Affinity Publisher / InDesign-style layout tools built in: pick a page size before you start, then drop free-floating text boxes, shapes, and photos on top of your text with fills, gradients, and blend modes.

## Features

### The page, before you write
- Tapping **Blank document** shows a page-size picker first: A4, A3, A5, US Letter, US Legal, Business card, Instagram Square/Story, or a fully **custom size** in mm / in / px
- Portrait/landscape toggle, and choose up front whether the page has a header/footer band
- **Quick note** and **Checklist** skip all of this and open straight into a simple, unpaged writing surface

### Word-style writing
- Rich text editing — bold, italic, underline, strikethrough, headings (H1–H3), block quotes, code blocks
- 4 font families, 7 sizes, text color + highlight color pickers
- Bullet, numbered, and tap-to-check checklist lists
- **Tables** — a visual row × column picker for quick sizes, or exact row/column counts up to 60×30; tap into any cell and a row/column toolbar appears at the bottom to insert, move, or delete rows and columns, or delete the whole table, any time after it's placed
- In-text pictures, links, divider lines, alignment, indentation
- Undo/redo, find & replace, live word/character count
- Rulers along the top and left edge of the page (toggle on/off), matching the page's unit
- **Add page** button on the toolbar — jump straight to a new page whenever you want, mid-sentence or not; the document also grows pages automatically just from writing past the bottom of one, no limit either way. Manual page breaks render as a real gap between pages, not just a line
- Header/footer bands you can turn on or off any time from **Page setup** — the footer is pinned to the bottom of the page itself (via flexbox), so it's in the right place even with just one line of content
- Formatting toggles — bold, italic, underline, strikethrough, headings, quote — correctly turn back **off** when you tap an already-active one a second time
- The bottom toolbar and bottom sheets stay above the on-screen keyboard instead of getting hidden underneath it

### Floating design objects (the "little bit of InDesign")
From the **Insert** sheet, add objects that float freely on top of the page — independent of the text flow, exactly like Word's own Insert → Shapes / Text Box, just with more style control:
- **Text boxes** — drag to move, drag the corner handle to resize, tap to edit
- **Shapes** — rectangle, ellipse, line
- **Floating pictures** — sit on top of the page, drag anywhere
- **Fill** — solid color, or a 2-color linear gradient with adjustable angle, or none
- **Stroke** color & width, corner radius, opacity
- **Blend modes** — Multiply, Screen, Overlay, Darken, Lighten, Color Dodge/Burn, Difference, Exclusion, Hue, Saturation, Color, Luminosity
- **Layering** — bring to front / send to back, duplicate, delete
- Optional link on any object

### Everywhere
- Searchable home screen with document cards, filter chips (Documents / Quick notes / Starred), starring
- A proper **Trash screen** (its own button, with an item-count badge) — preview any trashed item's content before deciding, restore exactly the one you pick while everything else stays put, or delete a single item (or empty the whole trash) permanently
- Autosave to on-device storage as you type — no account needed
- Installable PWA — "Add to Home Screen" on iOS/Android, works fully offline after first load
- Export: Word (`.docx`, built from scratch — no library), PDF at the page's exact size (via print), flattened PNG, and plain text (`.txt`)

## Project structure

```
jotly/
├── index.html         All screens: home, editor, and every bottom sheet
├── style.css           Design system & layout (cards, sheets, rulers, floating objects)
├── app.js               Everything: storage, editor commands, page setup, floating objects, export
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

This isn't a pixel-for-pixel clone of Microsoft Word, and it's not a full InDesign either — those are each decades-in-the-making products. What it covers: everyday word-processing (formatting, lists, tables, headers/footers, page sizes) plus a genuinely useful slice of free-form layout (floating text/shapes/photos with fill, gradient, blend modes, and layering).

Specific gaps worth knowing about:
- Floating objects have no rotate handle yet (rotation is stored per-object internally, but there's no drag-to-rotate UI)
- Lines are straight horizontal/vertical bars, not freely-angled vector paths — no vector pen tool
- Gradients are 2-color linear only — no radial or multi-stop gradients
- `.docx` export carries the flowing text (formatting, headings, lists, tables) but **not** the floating objects layer — Word doesn't have a simple-to-generate-from-scratch equivalent of "floating object over an OOXML paragraph flow," so those objects export cleanly to PDF/PNG instead
- No macros/VBA, no real-time multi-user collaboration, no mail merge, no advanced citation tooling
- Pagination for A4/A3/Letter/etc. pages is a **live preview, not real per-page editing**: while writing, dashed lines and "Page N" labels show you where the document will actually split (this is computed from your real content height, and is verified to match the exported PDF's page count) — but you're still editing one continuous flow, not clicking into a separate page 2. True per-page WYSIWYG editing (like desktop Word) would need a full custom layout engine, which is out of scope here.

Everything is stored locally in the browser (`localStorage`) — there's no server and no account, so data doesn't sync between devices unless you add that yourself.
