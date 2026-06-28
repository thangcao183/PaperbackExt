# Paperback Extensions

A repository of community manga/manhua/comic extensions for
[Paperback](https://github.com/Paperback-iOS/app) **v0.9**.

Sources are converted from the
[keiyoushi Tachiyomi extensions](https://github.com/keiyoushi/extensions-source).
Each upstream theme framework (Madara, MangaThemesia, Keyoapp, Iken, MangaHub,
HeanCms, ZeistManga, MMRCMS, and many more) is reimplemented once as a shared
TypeScript template, and every source built on that framework is generated from
it. A number of sources that don't share a framework (e.g. LikeManga, Mangago,
WeebCentral, MangaPill, MangaFreak, MangaKatana, Manga Demon, TCB Scans, Flame
Comics) are fully self-contained.

> [!IMPORTANT]
> **Not all sources have been tested.** These extensions are plain conversions
> of the keiyoushi Tachiyomi extensions, so while many work, some may be broken,
> incomplete, or out of date. If you find a source that isn't working, please
> [open an issue](../../issues) describing the problem (source name, what you
> did, and what went wrong). I maintain this in my spare time, so I'll get to
> fixes when I have free time — thanks for your patience and for helping improve
> the repository.

> [!NOTE]
> **Only sources that already exist in keiyoushi will be added here.** This
> repository is a port of the keiyoushi Tachiyomi extensions, not a place for
> brand-new sources. If a source exists in keiyoushi but isn't available here
> yet, please [open an issue](../../issues) to request it and I'll work on
> converting it.

### Features

- **Discover, search, details, chapters and pages** for every source.
- **Search sorting** — frameworks that support server-side ordering expose a
  sort dropdown (e.g. Madara: Relevance, Latest, A-Z, Rating, Trending, Most
  Views, New).
- **Advanced search filters** — author, artist, release year, status, type,
  adult content, genre condition, etc., depending on what the upstream
  framework supports.
- **Per-source settings** — every source has a settings form with a
  **base-URL override**, so you can point it at a new domain if the site moves
  without waiting for an update. Some frameworks add extra toggles (e.g.
  "show locked/paid chapters", "show adult content", image quality, a separate
  API-URL override).
- **Cloudflare challenge handling** via the bypass interceptor.
- **Source badges** in the extension list (the framework name, e.g. `Madara`,
  `Iken`, `MangaHub`, plus `Mature` for NSFW sources).

## Installation

### One-tap (recommended)

On the device that has Paperback (v0.9 or newer) installed, open the
installation page and tap **Add Repository to Paperback**, then confirm the
prompt:

**https://nicartjay.github.io/PaperbackExt/0.9/stable/**

The page lists every source — you can also tap individual sources and use the
**Install** button to add just the ones you want.

### Manual

If the one-tap link doesn't work, add the repository by hand:

1. Open Paperback (v0.9 or newer).
2. Go to **Settings → Extensions → Add Repository**.
3. Paste this URL:

   ```
   https://nicartjay.github.io/PaperbackExt/0.9/stable/
   ```

4. Install the sources you want and enjoy reading.

> Some sources sit behind Cloudflare. The first time you open them
> Paperback may show a Cloudflare challenge in a webview — solve it once and
> the cookies are stored for subsequent requests.

### Changing a source's domain

If a site moves to a new domain, open the source's **settings** (gear icon on
the source page) and set a **Base URL override**. The source will use your
override instead of the built-in domain until you reset it. Self-hosted
frameworks (e.g. Monochrome Custom, Bakkin Self-hosted) rely on this to point at
your own server.

## Contributing

Contributions are welcome — anyone can help fix a broken source or keep sources
up to date. You don't need write access; just fork the repo, make your change,
and open a pull request against `0.9/stable`. See
**[CONTRIBUTING.md](CONTRIBUTING.md)** for the full workflow (project layout,
version bumping, type-checking, and the stray-`.js` cleanup step).

If you've found a broken source but can't fix it yourself, please
[open an issue](../../issues) — a source name, the exact error, and an HTTP log
(Charles/Pulse) help a lot.

## Frameworks

The repository implements **24 shared theme frameworks** plus standalone
sources. Each framework lives under `src/utils/<framework>/` and is reused by
every source built on it.

| Framework | Style | Sources | Notes |
| --------- | ----- | ------: | ----- |
| Madara | HTML | 123 | WordPress theme; `mangaSubString` / `useNewChapterEndpoint` per source |
| MangaThemesia | HTML | 38 | Flat chapter URLs; `?title=&page=&order=` browse |
| Keyoapp | HTML | 19 | Homepage popular + client-side search; CSS background-image thumbs |
| MangaCatalog | HTML | 15 | Single-franchise sites with hardcoded title lists |
| Iken | JSON | 11 | `{apiUrl}/api/query|post|chapter`; locked-chapter toggle |
| MangaHub | GraphQL | 11 | Shared `api.mghcdn.com/graphql` with `x-mhub-access` key |
| madtheme | HTML | 4 | Chapter list via `/api/manga/{id}/chapters` |
| guya | JSON | 3 | `get_all_series` blob |
| manga18 | HTML | 3 | Base64-encoded page list |
| mangabox | HTML/JSON | 3 | Mirror list + chapter JSON API |
| HeanCms | JSON | 2 | `query`/`series`/`chapter`; paid-chapter toggle |
| MangAdventure | JSON | 2 | `api/v2` series/chapters/pages |
| Bakkin | JSON | 2 | Single `main.php` catalog blob |
| FoolSlide | HTML | 2 | POST search; `var pages = [...]` page list |
| EroMuse | HTML | 2 | Recursive NSFW album crawler |
| EZManhwa | JSON | 2 | `api/v1` on a separate API host |
| ManhwaZ | HTML | 2 | Madara-like |
| Monochrome | JSON | 2 | Dual base-URL + API-URL override |
| HotComics | HTML | 1 | Age-gate cookie; configurable browse list |
| MangaReader | HTML | 1 | Zoro-style two-step AJAX page fetch |
| Paprika | HTML | 1 | AJAX chapter list; `#arraydata` page list |
| Liliana | HTML | 1 | Two-step AJAX page fetch |
| ZeistManga | JSON/HTML | 1 | Blogger feed + HTML hybrid |
| MMRCMS | HTML | 1 | MyMangaReaderCMS |

Plus several standalone sources (not built on a shared framework):
**LikeManga**, **Mangago** (AES-decrypted image list + grid-descrambled
images, unscrambled in-process via Paperback's canvas polyfill),
**WeebCentral**, **MangaPill**, **MangaFreak**,
**MangaKatana**, **Manga Demon**, **TCB Scans**, **Flame Comics**,
**ReadComicOnline**, **AllManga**, **MangaGeko**, **Batcave**,
**MangaHere**, **AsuraScans**, **ComicK Fanmade**, **VyvyManga**,
**Temple Scan**, **ReadAllComics**, **MangaBolt**, **Manhwa18**,
**Oppai Stream**, **Comivex**, **MangaCloud**, **MangaBTT**,
**NineAnime**, **DFlowScans**, **Honkai Impact 3rd**, **New Manhwa**,
**Manhwalike**, **ScansGG**, **HeyToon**, **Kappa Beast**, **AsiaToon**,
**StoneScape**, **Manga Mirai**, **Alandal**, **Swords Comic**,
**Mangadotnet**, **XoManga**, **One Punch Man Online**, **Clone Manga**,
**The Duck Webcomics** and **Oglaf**.

## Available Sources

**422** sources are currently published. Sources marked **Mature** contain
adult/NSFW content (232 Mature, 190 Everyone).

The lists below group sources by manual testing status. **Tested** sources
have been verified working on a device. **Not yet tested** sources are plain
keiyoushi conversions that haven’t been checked yet (they may or may not
work). **Can’t test** sources can’t be verified right now — either they need
an account or credentials I don’t have, or the site itself is currently down.
If a source is broken, please open an issue.

### ✅ Tested (60)

| Source | Version | Content | Note |
| ------ | ------- | ------- | ---- |
| 8Muses | 1.4.2.1 | Mature |  |
| Asura Scans | 1.4.62.1 | Everyone |  |
| Bakkin | 1.4.7.1 | Everyone |  |
| BatCave | 1.4.6.6 | Everyone |  |
| Bbato | 1.4.1.1 | Mature |  |
| ComicK Fanmade | 1.4.2.1 | Mature |  |
| Coffee Manga | 1.4.56.2 | Mature |  |
| Comic Asura | 1.4.34.2 | Mature |  |
| Comix | 1.4.31.27 | Mature | Scanlation group shown in each chapter title, e.g. [Group]. |
| DragonTea | 1.4.56.2 | Everyone |  |
| Dynasty | 1.4.30.5 | Mature |  |
| EZmanga | 1.4.62.1 | Everyone |  |
| Flame Comics | 1.4.49.3 | Everyone |  |
| Gourmet Scans | 1.4.51.7 | Mature |  |
| Guya | 1.4.25.1 | Everyone |  |
| HentaiNexus | 1.4.17.2 | Mature |  |
| Hiperdex | 1.4.80.2 | Mature |  |
| Hive Scans | 1.4.65.3 | Everyone |  |
| HotComics | 1.4.2.4 | Mature |  |
| InfinityScans | 1.4.10.2 | Mature |  |
| Kaizen Scan | 1.4.20.4 | Mature | Coin-locked (paid) chapters can’t be opened — purchase required on the site. |
| KaliScan | 1.4.25.6 | Mature |  |
| K Manga | 1.4.5.8 | Everyone | Only unlocked/free chapters tested; rented/purchased chapters require logging in (region-locked to Japan). |
| LikeManga | 1.4.8.1 | Everyone |  |
| Lily Manga | 1.4.58.4 | Mature |  |
| MadaraDex | 1.4.54.4 | Mature |  |
| Magus Manga | 1.4.69.3 | Everyone |  |
| Mangadotnet | 1.4.11.2 | Mature |  |
| Mangago | 1.4.34.6 | Mature |  |
| Manga Demon | 1.4.19.4 | Everyone |  |
| MangaGeko | 1.4.32.1 | Mature |  |
| MangaFox | 1.4.9.1 | Mature |  |
| MangaHere.onl | 1.4.35.4 | Mature |  |
| MangaHub | 1.4.45.4 | Mature |  |
| MangaKatana | 1.4.12.2 | Mature |  |
| Mangakakalot | 1.4.21.13 | Mature |  |
| Mangakakalot.fun | 1.4.35.4 | Mature |  |
| Manganato | 1.4.18.14 | Mature |  |
| Mangafreak | 1.4.13.1 | Mature |  |
| MangaPill | 1.4.9.1 | Mature |  |
| Mangatown | 1.4.10.2 | Mature |  |
| ManhuaFast | 1.4.55.2 | Mature |  |
| ManhuaPlus (unoriginal) | 1.4.5.1 | Everyone |  |
| Manhwa18 | 1.4.13.1 | Mature |  |
| MurimScan | 1.4.49.3 | Mature | Paid (VIP) chapters can’t be opened — they require purchase/login on the site. |
| Omega Scans | 1.4.50.1 | Mature |  |
| Read Comics Online | 1.4.14.1 | Everyone |  |
| Read One Piece Manga Online | 1.4.8.3 | Everyone |  |
| ReadComicOnline | 1.4.43.13 | Everyone |  |
| Rinko Comics | 1.4.2.1 | Everyone |  |
| TCB Scans | 1.4.12.1 | Everyone |  |
| Tapas | 1.4.24.2 | Mature | Locked/paywalled chapters can’t be opened — purchase required. |
| The Blank | 1.4.56.12 | Mature |  |
| ToonGod | 1.4.56.9 | Mature |  |
| Toonily | 1.4.65.2 | Mature |  |
| Utoon | 1.4.55.4 | Everyone |  |
| VIZ | 1.4.25.6 | Everyone | Free chapters only; full library is region-gated (US). |
| Vortex Scans | 1.4.61.1 | Everyone |  |
| VyvyManga | 1.4.40.1 | Mature |  |
| Weeb Central | 1.4.22.2 | Mature |  |

### ⚠️ Can’t test (2)

These can’t be verified right now — they need credentials I don’t have, or the
site is currently down.

| Source | Version | Content | Note |
| ------ | ------- | ------- | ---- |
| BeeHentai | 1.4.24.4 | Mature | Server down — beehentai.com HTTPS origin is unresponsive (Cloudflare connects but the origin never replies). Affects all clients, not just Paperback. Will re-test when the site is back. |
| Madokami | 1.4.13.3 | Everyone | Needs HTTP Basic account credentials. |

### 🧪 Not yet tested (361)

| Source | Version | Content |
| ------ | ------- | ------- |
| 18 Porn Comic | 1.4.3.1 | Mature |
| 1Manga.co | 1.4.35.4 | Mature |
| 24HNovel | 1.4.52.2 | Mature |
| Akai Comic | 1.4.3.1 | Everyone |
| Alandal | 1.4.2.1 | Everyone |
| AllManga | 1.4.19.1 | Mature |
| AllPornComic | 1.4.53.2 | Mature |
| AllPornComic.io | 1.4.51.2 | Mature |
| Anisa Scans | 1.4.52.2 | Mature |
| AP Comics | 1.4.51.2 | Mature |
| Aqua Manga | 1.4.62.2 | Everyone |
| Arc-Relight | 1.4.15.1 | Everyone |
| Arena Scans | 1.4.32.1 | Everyone |
| Armageddon | 1.4.34.1 | Mature |
| Art Lapsa | 1.4.25.1 | Everyone |
| Arya Scans | 1.4.52.2 | Everyone |
| AsiaToon | 1.4.1.1 | Mature |
| Asmodeus Scans | 1.4.22.1 | Everyone |
| Assorted Scans | 1.4.17.1 | Everyone |
| Athrea Scans | 1.4.33.1 | Mature |
| Atsumaru | 1.4.19.1 | Mature |
| aurora | 1.4.4.1 | Everyone |
| Bakkin Self-hosted | 1.4.7.1 | Everyone |
| Battle In 5 Seconds After Meeting | 1.4.51.2 | Everyone |
| BookWalker | 1.4.7.1 | Mature |
| Borat Scans | 1.4.51.2 | Everyone |
| Broccoli Soup | 1.4.1.1 | Everyone |
| Bun Manga | 1.4.51.2 | Everyone |
| buttsmithy | 1.4.4.1 | Mature |
| Clone Manga | 1.4.3.1 | Everyone |
| Clown Corps | 1.4.3.1 | Everyone |
| CManhua | 1.4.1.1 | Mature |
| Cocomic | 1.4.53.2 | Mature |
| Collected Curios | 1.4.2.1 | Everyone |
| Comic CX | 1.4.1.1 | Mature |
| ComicHubFree | 1.4.3.1 | Everyone |
| ComicLand | 1.4.1.1 | Mature |
| Comics Land | 1.4.32.1 | Mature |
| Comivex | 1.4.3.1 | Everyone |
| Coolmic | 1.4.1.2 | Mature |
| Crow Scans | 1.4.32.1 | Everyone |
| Cucumber Manga | 1.4.51.2 | Mature |
| CulturedWorks | 1.4.33.1 | Mature |
| Cutie Comics | 1.4.5.1 | Mature |
| Cyanide & Happiness | 1.4.5.1 | Everyone |
| Danke fürs Lesen | 1.4.7.1 | Mature |
| Dark Legacy Comics | 1.4.1.1 | Everyone |
| Dark Science | 1.4.1.1 | Everyone |
| Darths & Droids | 1.4.2.1 | Everyone |
| Death Toll Scans | 1.4.5.1 | Everyone |
| Decadence Scans | 1.4.53.2 | Mature |
| DFlowScans | 1.4.1.1 | Everyone |
| Digital Comic Museum | 1.4.4.1 | Everyone |
| Diva Scans | 1.4.23.1 | Mature |
| Doujin.io - J18 | 1.4.3.1 | Mature |
| Doujins | 1.4.6.1 | Mature |
| Drake Scans | 1.4.48.1 | Everyone |
| Eggporncomics | 1.4.3.1 | Mature |
| El Goonish Shive | 1.4.2.1 | Everyone |
| Elan School | 1.4.1.1 | Everyone |
| Elf Toon | 1.4.34.1 | Everyone |
| emaqi | 1.4.1.2 | Mature |
| EpicManga | 1.4.51.2 | Mature |
| Eris Scans | 1.4.20.1 | Mature |
| Ero18x | 1.4.51.2 | Mature |
| Erofus | 1.4.3.1 | Mature |
| Eva Scans | 1.4.34.1 | Everyone |
| Existential Comics | 1.4.5.1 | Everyone |
| Fable Scans | 1.4.32.1 | Mature |
| Fairy Scans | 1.4.33.1 | Mature |
| Firescans | 1.4.55.2 | Everyone |
| FlameScans.lol | 1.4.52.2 | Everyone |
| Frieren Online | 1.4.51.2 | Everyone |
| GakaMangas | 1.4.51.2 | Everyone |
| Galaxy Manga | 1.4.32.1 | Mature |
| GalaxyDegenScans | 1.4.55.2 | Mature |
| GEDE Comix | 1.4.51.2 | Mature |
| Gensura | 1.4.3.1 | Mature |
| Genz Toons | 1.4.53.1 | Everyone |
| GingeRTooN | 1.4.51.2 | Mature |
| GirlsTop | 1.4.1.1 | Mature |
| Goda | 1.4.3.1 | Everyone |
| Gone with the Blastwave | 1.4.3.1 | Everyone |
| Greed Scans | 1.4.32.1 | Everyone |
| Grim Scans | 1.4.20.1 | Everyone |
| Grrl Power Comic | 1.4.4.1 | Everyone |
| Gunnerkrigg Court | 1.4.3.1 | Everyone |
| Hachirumi | 1.4.7.1 | Mature |
| Hades Scans | 1.4.33.1 | Everyone |
| Hentai3z.CC | 1.4.3.1 | Mature |
| Hentai4Free | 1.4.51.2 | Mature |
| HentaiDex | 1.4.34.1 | Mature |
| HentaiHere | 1.4.7.1 | Mature |
| HentaiKisu | 1.4.1.1 | Mature |
| HentaiKun | 1.4.1.1 | Mature |
| HentaiRead | 1.4.61.2 | Mature |
| HentaiRead.io | 1.4.1.1 | Mature |
| HentaiSco | 1.4.51.2 | Mature |
| HentaiXComic | 1.4.51.2 | Mature |
| HentaiXDickgirl | 1.4.51.2 | Mature |
| HentaiXYuri | 1.4.51.2 | Mature |
| Hentara | 1.4.3.1 | Mature |
| HeyToon | 1.4.1.1 | Mature |
| Hijala Scans | 1.4.23.1 | Everyone |
| Hiveworks Comics | 1.4.12.1 | Everyone |
| HM2D | 1.4.53.2 | Mature |
| Honkai Impact 3rd | 1.4.4.1 | Everyone |
| Hyakuro Translations | 1.4.1.1 | Mature |
| I | 1.4.7.1 | Everyone |
| I Roved Out | 1.4.5.1 | Mature |
| IsekaiScan.top (unoriginal) | 1.4.52.2 | Mature |
| J-Novel | 1.4.4.1 | Everyone |
| Jinmangas | 1.4.51.2 | Mature |
| Kappa Beast | 1.4.33.1 | Mature |
| Kayn Scans | 1.4.26.1 | Everyone |
| keenspot | 1.4.3.1 | Everyone |
| Ken Scans | 1.4.33.1 | Everyone |
| Kewn Scans | 1.4.21.1 | Everyone |
| Kill Six Billion Demons | 1.4.6.1 | Everyone |
| King of Shojo | 1.4.32.1 | Mature |
| KingComiX | 1.4.1.1 | Mature |
| Kissmanga.in | 1.4.55.2 | Mature |
| Kodansha | 1.4.1.1 | Mature |
| KokoMangas | 1.4.53.2 | Mature |
| KSGroupScans | 1.4.51.2 | Mature |
| Kun Manga Online | 1.4.52.2 | Mature |
| KuraManga | 1.4.2.1 | Mature |
| Lagoon Scans | 1.4.32.1 | Everyone |
| Leslie&Victims | 1.4.1.1 | Everyone |
| LHTranslation | 1.4.52.2 | Everyone |
| LinkManga | 1.4.51.2 | Mature |
| Loading Artist | 1.4.3.1 | Everyone |
| Lua Scans | 1.4.51.1 | Everyone |
| Luminare Translations | 1.4.3.1 | Everyone |
| Luna Toons | 1.4.20.1 | Mature |
| LustToon | 1.4.1.1 | Mature |
| Madara Scans | 1.4.34.1 | Everyone |
| Mahouirexnohentaikarte | 1.4.51.2 | Mature |
| Manga 18x | 1.4.52.2 | Mature |
| Manga Dass | 1.4.52.2 | Mature |
| Manga District | 1.4.67.2 | Mature |
| Manga Drama | 1.4.51.2 | Mature |
| Manga Hentai | 1.4.55.2 | Mature |
| Manga Kiss | 1.4.52.2 | Everyone |
| Manga Mirai | 1.4.1.1 | Everyone |
| Manga Read | 1.4.52.2 | Mature |
| Manga Trend | 1.4.32.1 | Everyone |
| Manga-Bay | 1.4.1.1 | Mature |
| Manga18.Club | 1.4.3.1 | Mature |
| Manga18Free | 1.4.52.2 | Mature |
| Manga18fx | 1.4.56.2 | Mature |
| Mangabat | 1.4.20.12 | Mature |
| MangaBlaze | 1.4.51.3 | Everyone |
| MangaBolt | 1.4.1.1 | Everyone |
| MangaBTT | 1.4.5.1 | Mature |
| Mangack | 1.4.2.1 | Everyone |
| MangaCloud | 1.4.7.1 | Everyone |
| MangaDE | 1.4.1.1 | Mature |
| MangaDia | 1.4.51.2 | Everyone |
| Mangaforfree.com | 1.4.53.2 | Mature |
| MangaFox.fun | 1.4.35.4 | Mature |
| Mangafree | 1.4.51.2 | Mature |
| MangaGG | 1.4.54.2 | Mature |
| MangaGo.fun | 1.4.51.2 | Everyone |
| MangaHe | 1.4.51.2 | Mature |
| Mangahere | 1.4.23.1 | Mature |
| MangaK | 1.4.30.1 | Mature |
| MangaKa | 1.4.51.2 | Everyone |
| MangaManiacs | 1.4.51.2 | Mature |
| Mangamo | 1.4.7.1 | Everyone |
| MangaNel | 1.4.35.4 | Mature |
| MangaNow | 1.4.4.1 | Mature |
| MangaOnline.fun | 1.4.35.4 | Mature |
| MangaOwl.io (unoriginal) | 1.4.52.2 | Mature |
| MangaPanda.onl | 1.4.35.4 | Everyone |
| MangaRead.org | 1.4.53.2 | Mature |
| MangaReader.in | 1.4.6.1 | Mature |
| MangaReader.site | 1.4.35.4 | Everyone |
| Mangasushi | 1.4.54.2 | Everyone |
| Mangatellers | 1.4.5.1 | Everyone |
| MangaToday | 1.4.35.4 | Mature |
| MangaTX | 1.4.33.1 | Mature |
| MangaYY | 1.4.52.2 | Mature |
| Manhua Plus | 1.4.58.2 | Everyone |
| Manhua Rush | 1.4.2.1 | Everyone |
| Manhua Zonghe | 1.4.52.2 | Mature |
| ManhuaFast.net (unoriginal) | 1.4.51.2 | Everyone |
| ManhuaHot | 1.4.51.2 | Everyone |
| Manhuanext | 1.4.52.2 | Everyone |
| Manhuascan.us | 1.4.32.1 | Mature |
| ManhuaTop | 1.4.52.2 | Mature |
| ManhuaUS | 1.4.56.2 | Everyone |
| Manhwa Comics | 1.4.51.2 | Mature |
| Manhwa Reads | 1.4.51.2 | Mature |
| Manhwa Toon | 1.4.52.2 | Mature |
| Manhwa XXL | 1.4.6.1 | Mature |
| Manhwa18.org | 1.4.53.2 | Mature |
| Manhwa68 | 1.4.54.2 | Mature |
| ManhwaBuddy | 1.4.3.1 | Mature |
| ManhwaDen | 1.4.51.2 | Mature |
| ManhwaGet | 1.4.51.2 | Everyone |
| ManhwaHub | 1.4.5.1 | Mature |
| Manhwajoy | 1.4.51.2 | Mature |
| Manhwalike | 1.4.3.1 | Mature |
| Manhwalover | 1.4.32.1 | Mature |
| ManhwaManhua | 1.4.51.2 | Mature |
| ManhwaNex | 1.4.51.2 | Everyone |
| ManhwaRead | 1.4.1.1 | Mature |
| Manhwatop | 1.4.53.2 | Mature |
| Manhwax | 1.4.32.1 | Mature |
| ManhwaZ | 1.4.42.1 | Mature |
| ManhwaZone | 1.4.1.1 | Mature |
| Megatokyo | 1.4.4.1 | Everyone |
| Mehgazone | 1.4.2.1 | Mature |
| MeiToon | 1.4.20.1 | Everyone |
| Mgread.io | 1.4.1.1 | Mature |
| Milftoon | 1.4.53.2 | Mature |
| Mist Scans | 1.4.21.1 | Everyone |
| MLBB Lore | 1.4.1.1 | Everyone |
| Monochrome Custom | 1.4.6.1 | Everyone |
| Monochrome Scans | 1.4.5.1 | Everyone |
| Multporn | 1.4.6.1 | Mature |
| MyAdultComics | 1.4.1.1 | Mature |
| MyHentaiComics | 1.4.4.1 | Mature |
| MyHentaiGallery | 1.4.9.1 | Mature |
| Necro Scans | 1.4.20.1 | Everyone |
| New Manhwa | 1.4.34.1 | Mature |
| NexComic | 1.4.32.1 | Mature |
| Nika Toons | 1.4.32.1 | Everyone |
| NineAnime | 1.4.6.1 | Mature |
| NineHentai | 1.4.6.1 | Mature |
| Ninekon | 1.4.1.1 | Mature |
| NixManga | 1.4.2.1 | Mature |
| NovelCrow | 1.4.52.2 | Mature |
| Noxen Scans | 1.4.32.1 | Everyone |
| Nux Scans | 1.4.2.1 | Everyone |
| Nyanu Kafe | 1.4.21.1 | Everyone |
| Nyra Scans | 1.4.20.1 | Mature |
| Nyx Scans | 1.4.26.1 | Everyone |
| OctopusManga | 1.4.51.2 | Mature |
| Oglaf | 1.4.4.1 | Mature |
| Oh Joy Sex Toy | 1.4.3.1 | Mature |
| Omoi | 1.4.2.2 | Mature |
| One Punch Man Online | 1.4.2.1 | Everyone |
| OneManga.info | 1.4.35.4 | Mature |
| Only The Best Hentai | 1.4.1.1 | Mature |
| oots | 1.4.3.1 | Everyone |
| Oppai Stream | 1.4.5.1 | Mature |
| Orchisasia | 1.4.51.2 | Mature |
| Orion Scans | 1.4.23.1 | Everyone |
| Paradise Scans | 1.4.20.1 | Mature |
| Paritehaber | 1.4.52.2 | Mature |
| Patch Friday | 1.4.2.1 | Everyone |
| Paw Manga | 1.4.51.2 | Mature |
| Petrotechsociety | 1.4.51.2 | Mature |
| Philia Scans | 1.4.58.2 | Everyone |
| PornComix | 1.4.49.1 | Mature |
| Qi Scans | 1.4.26.1 | Everyone |
| Questionable Content | 1.4.10.1 | Everyone |
| Rackus | 1.4.39.1 | Everyone |
| Rage Scans | 1.4.33.1 | Everyone |
| Randowiz | 1.4.2.1 | Everyone |
| Raven Scans | 1.4.34.1 | Mature |
| Razure | 1.4.32.1 | Everyone |
| RD Scans | 1.4.51.2 | Everyone |
| Read Attack on Titan Shingeki no Kyojin Manga | 1.4.13.1 | Everyone |
| Read Berserk Manga | 1.4.8.1 | Everyone |
| Read Black Clover Manga Online | 1.4.8.1 | Everyone |
| Read Boku no Hero Academia My Hero Academia Manga | 1.4.10.1 | Everyone |
| Read Chainsaw Man Manga Online | 1.4.9.1 | Mature |
| Read Fairy Tail & Edens Zero Manga Online | 1.4.9.1 | Everyone |
| Read Jujutsu Kaisen Manga Online | 1.4.9.1 | Everyone |
| Read Kingdom Manga Online | 1.4.8.1 | Everyone |
| Read Nanatsu no Taizai 7 Deadly Sins Manga Online | 1.4.10.1 | Everyone |
| Read Naruto Boruto Samurai 8 Manga Online | 1.4.9.1 | Everyone |
| Read One-Punch Man Manga Online | 1.4.8.1 | Everyone |
| Read Solo Leveling Manga Manhwa Online | 1.4.10.1 | Everyone |
| Read Tokyo Ghoul Re & Tokyo Ghoul Manga Online | 1.4.11.1 | Everyone |
| Read Vagabond Manga | 1.4.1.1 | Everyone |
| ReadAllComics | 1.4.8.1 | Everyone |
| Real Life Comics | 1.4.3.1 | Everyone |
| ReiManga | 1.4.1.1 | Mature |
| Renascans | 1.4.23.1 | Everyone |
| Reset Scans | 1.4.65.2 | Everyone |
| Rest Scans | 1.4.32.1 | Mature |
| Revival Scans | 1.4.1.1 | Mature |
| RitharScans | 1.4.23.1 | Everyone |
| Rizz Comic | 1.4.45.1 | Everyone |
| Rizz Comic (unoriginal) | 1.4.32.1 | Everyone |
| RokariComics | 1.4.34.1 | Everyone |
| Rolia Scan | 1.4.8.1 | Everyone |
| Rose Squad Scans | 1.4.52.2 | Mature |
| Ryumanga | 1.4.20.1 | Everyone |
| S2Manga | 1.4.55.2 | Mature |
| Sabrina Online | 1.4.1.1 | Everyone |
| SACACHISPA | 1.4.1.1 | Mature |
| Sana Scans | 1.4.23.1 | Everyone |
| Saturday Morning Breakfast Comics | 1.4.2.1 | Everyone |
| ScansGG | 1.4.1.1 | Mature |
| Schlock Mercenary | 1.4.2.1 | Everyone |
| Scythe Scans | 1.4.39.1 | Everyone |
| Setsu Scans | 1.4.54.2 | Everyone |
| Shiba Manga | 1.4.51.2 | Mature |
| Siren Scans | 1.4.20.1 | Everyone |
| Sky Manga | 1.4.33.1 | Mature |
| Sleepy Translations | 1.4.52.2 | Everyone |
| Solar and Sundry | 1.4.2.1 | Everyone |
| Spmanhwa | 1.4.51.2 | Everyone |
| SpyFakku | 1.4.15.1 | Mature |
| StoneScape | 1.4.49.1 | Everyone |
| Sunshine Butterfly Scans | 1.4.39.2 | Mature |
| SUPER MEGA | 1.4.4.1 | Everyone |
| Swords Comic | 1.4.5.1 | Everyone |
| Taroweb | 1.4.51.2 | Mature |
| TCB Scans (Unoriginal) | 1.4.32.1 | Everyone |
| Team Shadowi | 1.4.1.1 | Mature |
| Temple Scan | 1.4.49.1 | Mature |
| The Duck Webcomics | 1.4.3.1 | Mature |
| The Property of Hate | 1.4.5.1 | Everyone |
| TimelessToons | 1.4.20.1 | Everyone |
| TodayManga | 1.4.3.1 | Mature |
| Toon18 | 1.4.51.2 | Mature |
| Toonily.me | 1.4.24.1 | Mature |
| TooniTube | 1.4.24.1 | Mature |
| Toonizy | 1.4.51.2 | Mature |
| Top Manhua | 1.4.58.2 | Mature |
| TopManhua.fan | 1.4.51.2 | Mature |
| TopManhua.net | 1.4.51.2 | Mature |
| TritiniaScans | 1.4.55.2 | Everyone |
| Valir Scans | 1.4.22.1 | Everyone |
| Vanilla Scans | 1.4.23.1 | Everyone |
| vgperson | 1.4.7.1 | Everyone |
| Violet Scans | 1.4.35.1 | Everyone |
| Voyce.Me | 1.4.6.1 | Everyone |
| VyvyManga.org | 1.4.51.2 | Mature |
| War For Rayuba | 1.4.3.1 | Everyone |
| Webcomics | 1.4.10.1 | Everyone |
| Webdex Scans | 1.4.52.1 | Everyone |
| WebNovel | 1.4.13.1 | Everyone |
| WebtoonScan | 1.4.51.2 | Mature |
| WebtoonXYZ | 1.4.55.2 | Mature |
| Whale Manga | 1.4.51.2 | Mature |
| WitchScans | 1.4.32.1 | Everyone |
| WoopRead | 1.4.52.2 | Everyone |
| Writer Scans | 1.4.20.1 | Everyone |
| WuxiaWorld | 1.4.52.2 | Everyone |
| XlecX | 1.4.1.1 | Mature |
| XoManga | 1.4.1.1 | Mature |
| XOXO Comics | 1.4.13.1 | Everyone |
| Xscans | 1.4.1.1 | Everyone |
| YakshaComics | 1.4.53.2 | Everyone |
| YaoiHot | 1.4.1.1 | Mature |
| Yaoihub | 1.4.53.2 | Mature |
| YaoiScan | 1.4.51.2 | Mature |
| YaoiToon | 1.4.48.1 | Mature |
| Yorai | 1.4.2.1 | Everyone |
| Zazamanga | 1.4.52.2 | Mature |
| ZinChanManga | 1.4.54.2 | Mature |
| ZinChanManga.com | 1.4.54.2 | Mature |
| Zinmanga | 1.4.54.2 | Mature |
| Zinmanga.net | 1.4.51.2 | Everyone |

## Project Layout

```
src/
  <SourceName>/
    main.ts        # source instance (usually a small config one-liner)
    pbconfig.ts    # extension manifest (name, version, content rating, ...)
    static/
      icon.png     # source icon (from the upstream keiyoushi source)
  utils/
    <framework>/   # one folder per shared theme framework
      template.ts       # the shared extension implementation
      settings.ts       # base-URL override state + settings form
      forms.ts          # advanced-search form (when the framework supports it)
    url-builder/
      base.ts           # URL builder helper
      array-query-variant.ts
```

The Paperback bundler only treats a `src/` subfolder as a source when it
contains **both** `main.ts` and `pbconfig.ts`. Everything under `src/utils/` is
shared code and is ignored by the bundler, so a framework can be imported via a
relative path (e.g. `../utils/madara/template`).

### How a source is wired

Each source's `main.ts` is just a small config that instantiates its
framework's extension class:

```ts
import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const ManhuaFast = new MadaraExtension({
  name: "ManhuaFast",
  baseUrl: "https://manhuafast.com",
  mangaSubString: "manga",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
```

> **Important:** the exported `const` name **must exactly match the folder
> name** (which is the source id). The Paperback loader imports each source via
> a named import — `import { ManhuaFast } from "../ManhuaFast/main.js"` — so a
> mismatch makes the source fail to install.

Per-source options (e.g. `mangaSubString`, `useNewChapterEndpoint`, `apiUrl`,
`pageListSelector`, mirror lists) are ported from each upstream Kotlin source.
The shared template implements popular/latest discovery, search (with sorting +
advanced filters where supported), manga details, chapters, page lists,
lazy-image attribute fallbacks, status normalization, a per-source settings
form, and the Cloudflare challenge interceptor.

### Standalone sources

Many sources aren't built on a shared framework — they have a fully
self-contained `main.ts` that implements the Paperback interfaces directly.
These include the long-standing standalones (**LikeManga**, **Mangago**,
**WeebCentral**, **MangaPill**, **MangaFreak**, **MangaKatana**, **Manga Demon**,
**TCB Scans**, **Flame Comics**, **ReadComicOnline**, **AllManga**, **MangaGeko**,
**Batcave**, **MangaHere**, **AsuraScans**, **ComicK Fanmade**, **VyvyManga**,
**Temple Scan**, **ReadAllComics**, **MangaBolt**, **Manhwa18**, **Oppai Stream**,
**Comivex**, **MangaCloud**, **MangaBTT**, **NineAnime**, **DFlowScans**,
**Honkai Impact 3rd**, **Clone Manga**, **The Duck Webcomics**, **Oglaf**), the
many **self-contained webcomics** (e.g. Gunnerkrigg Court, Questionable Content,
Schlock Mercenary, El Goonish Shive, Megatokyo, Kill Six Billion Demons,
Darths & Droids, Hiveworks Comics, Cyanide & Happiness), **HTML/JSON manga &
gallery sites** (e.g. MangaFox, Mangatown, Dynasty, InfinityScans, Vortex Scans,
NineHentai, MyHentaiGallery, Multporn, Doujins), the four single-consumer theme
ports (**Goda**, **The Blank**, **XOXO Comics**, **Rolia Scan**), and the
auth/DRM platforms listed under *Notes & Limitations*. See the **Available
Sources** table above for the full list.

## Building

Requirements: Node.js 20+.

```bash
npm install        # install dependencies
npm run tsc        # typecheck (tsc --noEmit)
npm run bundle     # produce ./bundles
npm run serve      # serve ./bundles locally for testing in the app
```

`npm run bundle` outputs one folder per source under `bundles/`, plus
`versioning.json` (the repository manifest) and `index.html`.

## Deployment

Pushing to the `0.9/stable` branch triggers the
`.github/workflows/bundle-deploy.yaml` GitHub Action, which bundles every source
and publishes `bundles/` to the `gh-pages` branch under `0.9/stable/`. GitHub
Pages then serves it at the install URL above.

## Versioning

Versions use a four-part scheme: **`1.4.<keiyoushi>.<internal>`**.

The first three components mirror the upstream keiyoushi version for each
source, so upstream changes stay detectable:

- **Theme (framework) sources:** `1.4.(baseVersionCode + overrideVersionCode)`,
  where each framework's `baseVersionCode` comes from
  `lib-multisrc/<framework>/build.gradle.kts` and the per-source
  `overrideVersionCode` comes from `src/en/<dir>/build.gradle`.
- **Standalone sources:** `1.4.(extVersionCode)`.

The fourth component is this repo's **internal revision**. Bump it (`.1` →
`.2` → …) whenever a template or a source's config changes **without** a
corresponding upstream change, so the app still surfaces the update to users.

To pick up upstream updates, re-pull the keiyoushi repo and recompute the
first three components for each source. Any source whose recomputed
keiyoushi number is higher than the one published here has changed upstream
and should be reviewed; reset its internal revision to `.1` when you do.

## Notes & Limitations

- Sources are generated from shared framework logic. Standard sites on a given
  framework behave the same way as that framework's reference source.
- The Madara framework now carries per-source override knobs (load-more browsing,
  custom chapter/list/detail/page selectors, `chapterUrlSuffix`,
  `filterNonMangaItems`, etc.) mirroring the upstream keiyoushi subclasses, and
  the ~30 Madara sites with genuinely custom Kotlin logic (e.g. Hiperdex,
  Manga18fx, HentaiRead, Reset Scans, Manga District, Firescans' AES chapter
  protector, the year-inference date parsers) are reproduced as small
  `MadaraExtension` subclasses.
- The bespoke standalone (non-framework) keiyoushi **English** sources are now
  ported as well, so essentially the full English catalog (framework-based and
  standalone) is available. Multi-language (`src/all`) sources remain out of
  scope for now.
- **DRM page-image decryption is implemented.** A source interceptor's
  `interceptResponse` transforms the raw image `ArrayBuffer`: pixel/cell/tile
  descrambles run in-process on Paperback's polyfilled canvas
  (shared helpers in `src/utils/descramble/canvas.ts`), byte
  ciphers run directly on the `Uint8Array`, and AES/RSA use `window.crypto.subtle`.
  These sources now decode their scrambled / encrypted pages for free or owned
  content: **Mangago** (grid descramble), **Omoi** (Azuki, XOR), **K Manga**
  (cell descramble), **VIZ** (EXIF grid unshuffle), **Comix** (tile descramble +
  byte-XOR), **Coolmic** (PBKDF2 + AES-CBC), **Philia Scans** (AES-CTR/ChaCha20 +
  tile unscramble), **emaqi** (RSA-OAEP + AES-GCM). HentaiNexus and Sunshine
  Butterfly encrypt only metadata (already handled), not image bytes.
  `Application.executeInWebView` is still used where a source's own JavaScript
  must run (e.g. Mangago's per-image descrambling-key derivation), not for the
  pixel work.
- **Canvas-polyfill caveat for tile remaps.** Paperback's in-process canvas
  polyfill does **not** reliably honour the 9-argument
  `drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh)` source-crop form (the source
  sub-rectangle is ignored), and `getImageData`/`putImageData` apply an
  unreliable Y-axis origin that silently re-scrambles output. Tile cropping must
  therefore use only the 4-argument `drawImage(img, x, y, w, h)` form: draw the
  full image into a tile-sized scratch canvas shifted by `(-srcX0, -srcY0)` so
  only the wanted tile lands in bounds, then draw that scratch 1:1 to the
  destination position. **Comix** uses this technique; the Comix descramble math
  was validated off-device against a real scrambled page (seam-continuity
  reconstruction reproduced the page perfectly), proving the bug was the canvas
  primitive, not the permutation.
- **What still can't be bypassed is payment/login, not decryption.** Chapters a
  site refuses to serve to an anonymous/un-purchased account (most paid content on
  **K Manga**, **VIZ**, **Kodansha**, **Mangamo**, **WebNovel**, **J-Novel**,
  **BookWalker**, **Tapas**, **Coolmic**) return no bytes to decrypt, and
  **Madokami** needs HTTP Basic credentials. **The Blank**'s libsodium
  secretstream image layer (X25519 key-exchange + HMAC-signed URLs +
  XChaCha20-Poly1305 secretstream) is now fully reproduced in the runtime, so its
  images decrypt and render correctly. Browsing, search, details and chapter
  lists work for all of these.
- These extensions are **not affiliated** with the source websites. They only
  scrape publicly available pages.

## Upstream Sync Tracker

<!-- Machine-readable keiyoushi sync state. Format:
     LAST_REVIEWED_COMMIT=<full sha>
     LAST_REVIEWED_DATE=<ISO 8601>
     LAST_APPLIED_COMMIT=<full sha of newest commit that resulted in a code change>
     LAST_APPLIED_PR=<PR number>
     REVIEW_SCOPE=all English sources in our repo (~423 sources)
-->

```
LAST_REVIEWED_COMMIT=5e814a05963689af38ea58961c9614cd47b1e089
LAST_REVIEWED_DATE=2026-06-26
LAST_APPLIED_COMMIT=1cdc173a7acf54d8fb8234d3f5d31c9de800154e
LAST_APPLIED_PR=#16971
BASELINE_PORT_DATE=2026-06-20
```

**How to read:** All keiyoushi commits up to and including `LAST_REVIEWED_COMMIT`
have been evaluated against our sources. `LAST_APPLIED_COMMIT` is the newest
upstream commit that produced an actual code change here (MangaBlaze theme rework,
PR #16971). Others in the reviewed range were no-ops (already implemented, auto-
fetched at runtime, or for sources we don't carry). To check for new upstream
changes, compare `LAST_REVIEWED_COMMIT` against
`https://github.com/keiyoushi/extensions-source/commits/main`.

## Credits

- [Paperback](https://github.com/Paperback-iOS/app) for the app and extension SDK.
- [keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source)
  for the original Tachiyomi sources and icons.
- The **keiyoushi extension developers and contributors**, whose original work
  every source in this repository is ported from. All credit for the source
  logic, scraping, and decryption belongs to them — this repository only adapts
  their extensions to the Paperback runtime. See the
  [keiyoushi contributors](https://github.com/keiyoushi/extensions-source/graphs/contributors)
  for the full list of authors.

