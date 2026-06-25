# Contributing

Thanks for your interest in improving this repository! It's a collection of
[Paperback](https://github.com/Paperback-iOS/app) **v0.9** extensions, ported
from the [keiyoushi Tachiyomi extensions](https://github.com/keiyoushi/extensions-source).
Anyone is welcome to fix a broken source, improve a framework, or help keep
sources up to date.

## Scope

This repo is a **port of keiyoushi sources** — it is not a place for brand-new
sources that don't exist upstream. If you want a source that exists in
keiyoushi but isn't here yet, please [open an issue](../../issues) to request
it.

## How to contribute

You don't need write access — use the standard fork & pull-request flow:

1. **Fork** this repository.
2. **Clone** your fork and create a branch:
   ```bash
   git clone https://github.com/<your-username>/PaperbackExt.git
   cd PaperbackExt
   git checkout 0.9/stable
   git switch -c fix/<source-name>
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. Make your change (see below).
5. **Type-check** and clean up before committing (see the important note about
   stray `.js` files):
   ```bash
   npm run tsc
   git clean -f src
   ```
6. **Commit and push** to your fork, then open a **Pull Request** against the
   `0.9/stable` branch of this repo.

## Project layout

- Each source lives in `src/<SourceName>/` and must contain:
  - `main.ts` — the source implementation (exports a `const` whose name matches
    the folder, e.g. `export const Comix = ...`).
  - `pbconfig.ts` — the extension manifest (name, version, content rating,
    capabilities, badges).
  - `static/icon.png` — the source icon.
- Shared theme frameworks live under `src/utils/<framework>/` (Madara,
  MangaThemesia, Keyoapp, etc.). Most sources are thin configs that instantiate
  a shared framework class; standalone sources implement the Paperback
  interfaces directly.
- A change to a framework template under `src/utils/` affects **every** source
  built on it, so test broadly when editing shared code.

## Making a change

- **Fixing one source:** edit `src/<SourceName>/main.ts`.
- **Bump the version** in that source's `pbconfig.ts`. Versions are four-part
  `1.4.<keiyoushi>.<internal>`; increment the last number (e.g.
  `1.4.31.26` → `1.4.31.27`).
- Keep the code style consistent with the surrounding source. You can run
  `npm run format` (oxfmt) and `npm run lint` (oxlint) if you have them.

## ⚠️ Important: stray `.js` files

`tsconfig.json` does **not** set `noEmit`, so running `npm run tsc` emits a
compiled `.js` file next to every `.ts` file in `src/`. These must **never** be
committed. Always run:

```bash
git clean -f src
```

before `git add`. Only commit the `.ts` / `pbconfig.ts` / `README.md` files you
actually changed.

## Useful commands

| Command | What it does |
| ------- | ------------ |
| `npm install` | Install dependencies |
| `npm run tsc` | Type-check (⚠️ emits stray `.js` — clean afterwards) |
| `npm run bundle` | Bundle all sources into `bundles/` |
| `npm run serve` | Serve the bundles locally for testing in Paperback |
| `npm run dev` | Serve with `--watch` on port 3000 |
| `npm run lint` | Lint with oxlint |
| `npm run format` | Format with oxfmt |

## Testing your change

These extensions need Paperback's iOS runtime, so the most reliable test is on a
device:

1. `npm run serve` (or `npm run dev`) to host the bundles locally.
2. Add your local server URL as a repository in Paperback
   (**Settings → Extensions → Add Repository**).
3. Install the source and verify the homepage, search, manga details, chapter
   list and reading all work.

If you can't test on a device, say so in your PR description so the maintainer
knows it still needs verification.

## Reporting bugs

If you've found a broken source but can't fix it yourself, please
[open an issue](../../issues) with:

- The **source name**.
- **What you did** and **what went wrong** (exact error message helps a lot).
- A **log** if you can capture one (Charles/Pulse HTTP logs are especially
  useful for diagnosing scraping/CDN issues).

## Deployment

Pushing to `0.9/stable` triggers a GitHub Action that bundles every source and
publishes to GitHub Pages. Only the maintainer merges to `0.9/stable`, so your
PR will be deployed once it's reviewed and merged.
