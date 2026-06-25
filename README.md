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

The **Status** column reflects manual testing. **✅ Tested** means the source
has been verified working on a device; **Not yet tested** means it is a plain
keiyoushi conversion that hasn't been checked yet (it may or may not work);
**⚠️ Can't test** means the source requires an account or credentials I don't
have, so I'm unable to verify it. If a source is broken, please open an issue.

| Source | Version | Content | Status |
| ------ | ------- | ------- | ------ |
| 18 Porn Comic | 1.4.3.1 | Mature | Not yet tested |
| 1Manga.co | 1.4.35.4 | Mature | Not yet tested |
| 24HNovel | 1.4.52.2 | Mature | Not yet tested |
| 8Muses | 1.4.2.1 | Mature | Not yet tested |
| Akai Comic | 1.4.3.1 | Everyone | Not yet tested |
| Alandal | 1.4.2.1 | Everyone | Not yet tested |
| AllManga | 1.4.19.1 | Mature | Not yet tested |
| AllPornComic | 1.4.53.2 | Mature | Not yet tested |
| AllPornComic.io | 1.4.51.2 | Mature | Not yet tested |
| Anisa Scans | 1.4.52.2 | Mature | Not yet tested |
| AP Comics | 1.4.51.2 | Mature | Not yet tested |
| Aqua Manga | 1.4.62.2 | Everyone | Not yet tested |
| Arc-Relight | 1.4.15.1 | Everyone | Not yet tested |
| Arena Scans | 1.4.32.1 | Everyone | Not yet tested |
| Armageddon | 1.4.34.1 | Mature | Not yet tested |
| Art Lapsa | 1.4.25.1 | Everyone | Not yet tested |
| Arya Scans | 1.4.52.2 | Everyone | Not yet tested |
| AsiaToon | 1.4.1.1 | Mature | Not yet tested |
| Asmodeus Scans | 1.4.22.1 | Everyone | Not yet tested |
| Assorted Scans | 1.4.17.1 | Everyone | Not yet tested |
| Asura Scans | 1.4.62.1 | Everyone | Not yet tested |
| Athrea Scans | 1.4.33.1 | Mature | Not yet tested |
| Atsumaru | 1.4.19.1 | Mature | Not yet tested |
| aurora | 1.4.4.1 | Everyone | Not yet tested |
| Bakkin | 1.4.7.1 | Everyone | Not yet tested |
| Bakkin Self-hosted | 1.4.7.1 | Everyone | Not yet tested |
| BatCave | 1.4.6.1 | Everyone | Not yet tested |
| Battle In 5 Seconds After Meeting | 1.4.51.2 | Everyone | Not yet tested |
| Bbato | 1.4.1.1 | Mature | Not yet tested |
| BeeHentai | 1.4.24.1 | Mature | Not yet tested |
| BookWalker | 1.4.7.1 | Mature | Not yet tested |
| Borat Scans | 1.4.51.2 | Everyone | Not yet tested |
| Broccoli Soup | 1.4.1.1 | Everyone | Not yet tested |
| Bun Manga | 1.4.51.2 | Everyone | Not yet tested |
| buttsmithy | 1.4.4.1 | Mature | Not yet tested |
| Clone Manga | 1.4.3.1 | Everyone | Not yet tested |
| Clown Corps | 1.4.3.1 | Everyone | Not yet tested |
| CManhua | 1.4.1.1 | Mature | Not yet tested |
| Cocomic | 1.4.53.2 | Mature | Not yet tested |
| Coffee Manga | 1.4.56.2 | Mature | Not yet tested |
| Collected Curios | 1.4.2.1 | Everyone | Not yet tested |
| Comic Asura | 1.4.34.1 | Mature | Not yet tested |
| Comic CX | 1.4.1.1 | Mature | Not yet tested |
| ComicHubFree | 1.4.3.1 | Everyone | Not yet tested |
| ComicK Fanmade | 1.4.2.1 | Mature | Not yet tested |
| ComicLand | 1.4.1.1 | Mature | Not yet tested |
| Comics Land | 1.4.32.1 | Mature | Not yet tested |
| Comivex | 1.4.3.1 | Everyone | Not yet tested |
| Comix | 1.4.31.25 | Mature | ✅ Tested |
| Coolmic | 1.4.1.2 | Mature | Not yet tested |
| Crow Scans | 1.4.32.1 | Everyone | Not yet tested |
| Cucumber Manga | 1.4.51.2 | Mature | Not yet tested |
| CulturedWorks | 1.4.33.1 | Mature | Not yet tested |
| Cutie Comics | 1.4.5.1 | Mature | Not yet tested |
| Cyanide & Happiness | 1.4.5.1 | Everyone | Not yet tested |
| Danke fürs Lesen | 1.4.7.1 | Mature | Not yet tested |
| Dark Legacy Comics | 1.4.1.1 | Everyone | Not yet tested |
| Dark Science | 1.4.1.1 | Everyone | Not yet tested |
| Darths & Droids | 1.4.2.1 | Everyone | Not yet tested |
| Death Toll Scans | 1.4.5.1 | Everyone | Not yet tested |
| Decadence Scans | 1.4.53.2 | Mature | Not yet tested |
| DFlowScans | 1.4.1.1 | Everyone | Not yet tested |
| Digital Comic Museum | 1.4.4.1 | Everyone | Not yet tested |
| Diva Scans | 1.4.23.1 | Mature | Not yet tested |
| Doujin.io - J18 | 1.4.3.1 | Mature | Not yet tested |
| Doujins | 1.4.6.1 | Mature | Not yet tested |
| DragonTea | 1.4.56.2 | Everyone | Not yet tested |
| Drake Scans | 1.4.48.1 | Everyone | Not yet tested |
| Dynasty | 1.4.30.2 | Mature | Not yet tested |
| Eggporncomics | 1.4.3.1 | Mature | Not yet tested |
| El Goonish Shive | 1.4.2.1 | Everyone | Not yet tested |
| Elan School | 1.4.1.1 | Everyone | Not yet tested |
| Elf Toon | 1.4.34.1 | Everyone | Not yet tested |
| emaqi | 1.4.1.2 | Mature | Not yet tested |
| EpicManga | 1.4.51.2 | Mature | Not yet tested |
| Eris Scans | 1.4.20.1 | Mature | Not yet tested |
| Ero18x | 1.4.51.2 | Mature | Not yet tested |
| Erofus | 1.4.3.1 | Mature | Not yet tested |
| Eva Scans | 1.4.34.1 | Everyone | Not yet tested |
| Existential Comics | 1.4.5.1 | Everyone | Not yet tested |
| EZmanga | 1.4.62.1 | Everyone | Not yet tested |
| Fable Scans | 1.4.32.1 | Mature | Not yet tested |
| Fairy Scans | 1.4.33.1 | Mature | Not yet tested |
| Firescans | 1.4.55.2 | Everyone | Not yet tested |
| Flame Comics | 1.4.49.1 | Everyone | Not yet tested |
| FlameScans.lol | 1.4.52.2 | Everyone | Not yet tested |
| Frieren Online | 1.4.51.2 | Everyone | Not yet tested |
| GakaMangas | 1.4.51.2 | Everyone | Not yet tested |
| Galaxy Manga | 1.4.32.1 | Mature | Not yet tested |
| GalaxyDegenScans | 1.4.55.2 | Mature | Not yet tested |
| GEDE Comix | 1.4.51.2 | Mature | Not yet tested |
| Gensura | 1.4.3.1 | Mature | Not yet tested |
| Genz Toons | 1.4.53.1 | Everyone | Not yet tested |
| GingeRTooN | 1.4.51.2 | Mature | Not yet tested |
| GirlsTop | 1.4.1.1 | Mature | Not yet tested |
| Goda | 1.4.3.1 | Everyone | Not yet tested |
| Gone with the Blastwave | 1.4.3.1 | Everyone | Not yet tested |
| Gourmet Scans | 1.4.51.7 | Mature | ✅ Tested |
| Greed Scans | 1.4.32.1 | Everyone | Not yet tested |
| Grim Scans | 1.4.20.1 | Everyone | Not yet tested |
| Grrl Power Comic | 1.4.4.1 | Everyone | Not yet tested |
| Gunnerkrigg Court | 1.4.3.1 | Everyone | Not yet tested |
| Guya | 1.4.25.1 | Everyone | Not yet tested |
| Hachirumi | 1.4.7.1 | Mature | Not yet tested |
| Hades Scans | 1.4.33.1 | Everyone | Not yet tested |
| Hentai3z.CC | 1.4.3.1 | Mature | Not yet tested |
| Hentai4Free | 1.4.51.2 | Mature | Not yet tested |
| HentaiDex | 1.4.34.1 | Mature | Not yet tested |
| HentaiHere | 1.4.7.1 | Mature | Not yet tested |
| HentaiKisu | 1.4.1.1 | Mature | Not yet tested |
| HentaiKun | 1.4.1.1 | Mature | Not yet tested |
| HentaiNexus | 1.4.17.2 | Mature | ✅ Tested |
| HentaiRead | 1.4.61.2 | Mature | Not yet tested |
| HentaiRead.io | 1.4.1.1 | Mature | Not yet tested |
| HentaiSco | 1.4.51.2 | Mature | Not yet tested |
| HentaiXComic | 1.4.51.2 | Mature | Not yet tested |
| HentaiXDickgirl | 1.4.51.2 | Mature | Not yet tested |
| HentaiXYuri | 1.4.51.2 | Mature | Not yet tested |
| Hentara | 1.4.3.1 | Mature | Not yet tested |
| HeyToon | 1.4.1.1 | Mature | Not yet tested |
| Hijala Scans | 1.4.23.1 | Everyone | Not yet tested |
| Hiperdex | 1.4.80.2 | Mature | Not yet tested |
| Hive Scans | 1.4.65.1 | Everyone | Not yet tested |
| Hiveworks Comics | 1.4.12.1 | Everyone | Not yet tested |
| HM2D | 1.4.53.2 | Mature | Not yet tested |
| Honkai Impact 3rd | 1.4.4.1 | Everyone | Not yet tested |
| HotComics | 1.4.2.1 | Mature | Not yet tested |
| Hyakuro Translations | 1.4.1.1 | Mature | Not yet tested |
| I | 1.4.7.1 | Everyone | Not yet tested |
| I Roved Out | 1.4.5.1 | Mature | Not yet tested |
| InfinityScans | 1.4.10.1 | Mature | Not yet tested |
| IsekaiScan.top (unoriginal) | 1.4.52.2 | Mature | Not yet tested |
| J-Novel | 1.4.4.1 | Everyone | Not yet tested |
| Jinmangas | 1.4.51.2 | Mature | Not yet tested |
| K Manga | 1.4.5.4 | Everyone | Not yet tested |
| Kaizen Scan | 1.4.20.1 | Mature | Not yet tested |
| KaliScan | 1.4.25.1 | Mature | Not yet tested |
| Kappa Beast | 1.4.33.1 | Mature | Not yet tested |
| Kayn Scans | 1.4.26.1 | Everyone | Not yet tested |
| keenspot | 1.4.3.1 | Everyone | Not yet tested |
| Ken Scans | 1.4.33.1 | Everyone | Not yet tested |
| Kewn Scans | 1.4.21.1 | Everyone | Not yet tested |
| Kill Six Billion Demons | 1.4.6.1 | Everyone | Not yet tested |
| King of Shojo | 1.4.32.1 | Mature | Not yet tested |
| KingComiX | 1.4.1.1 | Mature | Not yet tested |
| Kissmanga.in | 1.4.55.2 | Mature | Not yet tested |
| Kodansha | 1.4.1.1 | Mature | Not yet tested |
| KokoMangas | 1.4.53.2 | Mature | Not yet tested |
| KSGroupScans | 1.4.51.2 | Mature | Not yet tested |
| Kun Manga Online | 1.4.52.2 | Mature | Not yet tested |
| KuraManga | 1.4.2.1 | Mature | Not yet tested |
| Lagoon Scans | 1.4.32.1 | Everyone | Not yet tested |
| Leslie&Victims | 1.4.1.1 | Everyone | Not yet tested |
| LHTranslation | 1.4.52.2 | Everyone | Not yet tested |
| LikeManga | 1.4.8.1 | Everyone | ✅ Tested |
| Lily Manga | 1.4.58.4 | Mature | ✅ Tested |
| LinkManga | 1.4.51.2 | Mature | Not yet tested |
| Loading Artist | 1.4.3.1 | Everyone | Not yet tested |
| Lua Scans | 1.4.51.1 | Everyone | Not yet tested |
| Luminare Translations | 1.4.3.1 | Everyone | Not yet tested |
| Luna Toons | 1.4.20.1 | Mature | Not yet tested |
| LustToon | 1.4.1.1 | Mature | Not yet tested |
| Madara Scans | 1.4.34.1 | Everyone | Not yet tested |
| MadaraDex | 1.4.54.2 | Mature | Not yet tested |
| Madokami | 1.4.13.3 | Everyone | ⚠️ Can't test (needs account) |
| Magus Manga | 1.4.69.1 | Everyone | Not yet tested |
| Mahouirexnohentaikarte | 1.4.51.2 | Mature | Not yet tested |
| Manga 18x | 1.4.52.2 | Mature | Not yet tested |
| Manga Dass | 1.4.52.2 | Mature | Not yet tested |
| Manga Demon | 1.4.19.1 | Everyone | Not yet tested |
| Manga District | 1.4.67.2 | Mature | Not yet tested |
| Manga Drama | 1.4.51.2 | Mature | Not yet tested |
| Manga Hentai | 1.4.55.2 | Mature | Not yet tested |
| Manga Kiss | 1.4.52.2 | Everyone | Not yet tested |
| Manga Mirai | 1.4.1.1 | Everyone | Not yet tested |
| Manga Read | 1.4.52.2 | Mature | Not yet tested |
| Manga Trend | 1.4.32.1 | Everyone | Not yet tested |
| Manga-Bay | 1.4.1.1 | Mature | Not yet tested |
| Manga18.Club | 1.4.3.1 | Mature | Not yet tested |
| Manga18Free | 1.4.52.2 | Mature | Not yet tested |
| Manga18fx | 1.4.56.2 | Mature | Not yet tested |
| Mangabat | 1.4.20.1 | Mature | Not yet tested |
| MangaBlaze | 1.4.51.2 | Everyone | Not yet tested |
| MangaBolt | 1.4.1.1 | Everyone | Not yet tested |
| MangaBTT | 1.4.5.1 | Mature | Not yet tested |
| Mangack | 1.4.2.1 | Everyone | Not yet tested |
| MangaCloud | 1.4.7.1 | Everyone | Not yet tested |
| MangaDE | 1.4.1.1 | Mature | Not yet tested |
| MangaDia | 1.4.51.2 | Everyone | Not yet tested |
| Mangadotnet | 1.4.11.1 | Mature | ✅ Tested |
| Mangaforfree.com | 1.4.53.2 | Mature | Not yet tested |
| MangaFox | 1.4.9.1 | Mature | Not yet tested |
| MangaFox.fun | 1.4.35.4 | Mature | Not yet tested |
| Mangafreak | 1.4.13.1 | Mature | Not yet tested |
| Mangafree | 1.4.51.2 | Mature | Not yet tested |
| MangaGeko | 1.4.32.1 | Mature | Not yet tested |
| MangaGG | 1.4.54.2 | Mature | Not yet tested |
| Mangago | 1.4.34.5 | Mature | ✅ Tested |
| MangaGo.fun | 1.4.51.2 | Everyone | Not yet tested |
| MangaHe | 1.4.51.2 | Mature | Not yet tested |
| Mangahere | 1.4.23.1 | Mature | Not yet tested |
| MangaHere.onl | 1.4.35.4 | Mature | ✅ Tested |
| MangaHub | 1.4.45.4 | Mature | ✅ Tested |
| MangaK | 1.4.30.1 | Mature | Not yet tested |
| MangaKa | 1.4.51.2 | Everyone | Not yet tested |
| Mangakakalot | 1.4.21.1 | Mature | Not yet tested |
| Mangakakalot.fun | 1.4.35.4 | Mature | Not yet tested |
| MangaKatana | 1.4.12.1 | Mature | Not yet tested |
| MangaManiacs | 1.4.51.2 | Mature | Not yet tested |
| Mangamo | 1.4.7.1 | Everyone | Not yet tested |
| Manganato | 1.4.18.1 | Mature | Not yet tested |
| MangaNel | 1.4.35.4 | Mature | Not yet tested |
| MangaNow | 1.4.4.1 | Mature | Not yet tested |
| MangaOnline.fun | 1.4.35.4 | Mature | Not yet tested |
| MangaOwl.io (unoriginal) | 1.4.52.2 | Mature | Not yet tested |
| MangaPanda.onl | 1.4.35.4 | Everyone | Not yet tested |
| MangaPill | 1.4.9.1 | Mature | Not yet tested |
| MangaRead.org | 1.4.53.2 | Mature | Not yet tested |
| MangaReader.in | 1.4.6.1 | Mature | Not yet tested |
| MangaReader.site | 1.4.35.4 | Everyone | Not yet tested |
| Mangasushi | 1.4.54.2 | Everyone | Not yet tested |
| Mangatellers | 1.4.5.1 | Everyone | Not yet tested |
| MangaToday | 1.4.35.4 | Mature | Not yet tested |
| Mangatown | 1.4.10.1 | Mature | Not yet tested |
| MangaTX | 1.4.33.1 | Mature | Not yet tested |
| MangaYY | 1.4.52.2 | Mature | Not yet tested |
| Manhua Plus | 1.4.58.2 | Everyone | Not yet tested |
| Manhua Rush | 1.4.2.1 | Everyone | Not yet tested |
| Manhua Zonghe | 1.4.52.2 | Mature | Not yet tested |
| ManhuaFast | 1.4.55.2 | Mature | ✅ Tested |
| ManhuaFast.net (unoriginal) | 1.4.51.2 | Everyone | Not yet tested |
| ManhuaHot | 1.4.51.2 | Everyone | Not yet tested |
| Manhuanext | 1.4.52.2 | Everyone | Not yet tested |
| ManhuaPlus (unoriginal) | 1.4.5.1 | Everyone | Not yet tested |
| Manhuascan.us | 1.4.32.1 | Mature | Not yet tested |
| ManhuaTop | 1.4.52.2 | Mature | Not yet tested |
| ManhuaUS | 1.4.56.2 | Everyone | Not yet tested |
| Manhwa Comics | 1.4.51.2 | Mature | Not yet tested |
| Manhwa Reads | 1.4.51.2 | Mature | Not yet tested |
| Manhwa Toon | 1.4.52.2 | Mature | Not yet tested |
| Manhwa XXL | 1.4.6.1 | Mature | Not yet tested |
| Manhwa18 | 1.4.13.1 | Mature | Not yet tested |
| Manhwa18.org | 1.4.53.2 | Mature | Not yet tested |
| Manhwa68 | 1.4.54.2 | Mature | Not yet tested |
| ManhwaBuddy | 1.4.3.1 | Mature | Not yet tested |
| ManhwaDen | 1.4.51.2 | Mature | Not yet tested |
| ManhwaGet | 1.4.51.2 | Everyone | Not yet tested |
| ManhwaHub | 1.4.5.1 | Mature | Not yet tested |
| Manhwajoy | 1.4.51.2 | Mature | Not yet tested |
| Manhwalike | 1.4.3.1 | Mature | Not yet tested |
| Manhwalover | 1.4.32.1 | Mature | Not yet tested |
| ManhwaManhua | 1.4.51.2 | Mature | Not yet tested |
| ManhwaNex | 1.4.51.2 | Everyone | Not yet tested |
| ManhwaRead | 1.4.1.1 | Mature | Not yet tested |
| Manhwatop | 1.4.53.2 | Mature | Not yet tested |
| Manhwax | 1.4.32.1 | Mature | Not yet tested |
| ManhwaZ | 1.4.42.1 | Mature | Not yet tested |
| ManhwaZone | 1.4.1.1 | Mature | Not yet tested |
| Megatokyo | 1.4.4.1 | Everyone | Not yet tested |
| Mehgazone | 1.4.2.1 | Mature | Not yet tested |
| MeiToon | 1.4.20.1 | Everyone | Not yet tested |
| Mgread.io | 1.4.1.1 | Mature | Not yet tested |
| Milftoon | 1.4.53.2 | Mature | Not yet tested |
| Mist Scans | 1.4.21.1 | Everyone | Not yet tested |
| MLBB Lore | 1.4.1.1 | Everyone | Not yet tested |
| Monochrome Custom | 1.4.6.1 | Everyone | Not yet tested |
| Monochrome Scans | 1.4.5.1 | Everyone | Not yet tested |
| Multporn | 1.4.6.1 | Mature | Not yet tested |
| MurimScan | 1.4.49.1 | Mature | Not yet tested |
| MyAdultComics | 1.4.1.1 | Mature | Not yet tested |
| MyHentaiComics | 1.4.4.1 | Mature | Not yet tested |
| MyHentaiGallery | 1.4.9.1 | Mature | Not yet tested |
| Necro Scans | 1.4.20.1 | Everyone | Not yet tested |
| New Manhwa | 1.4.34.1 | Mature | Not yet tested |
| NexComic | 1.4.32.1 | Mature | Not yet tested |
| Nika Toons | 1.4.32.1 | Everyone | Not yet tested |
| NineAnime | 1.4.6.1 | Mature | Not yet tested |
| NineHentai | 1.4.6.1 | Mature | Not yet tested |
| Ninekon | 1.4.1.1 | Mature | Not yet tested |
| NixManga | 1.4.2.1 | Mature | Not yet tested |
| NovelCrow | 1.4.52.2 | Mature | Not yet tested |
| Noxen Scans | 1.4.32.1 | Everyone | Not yet tested |
| Nux Scans | 1.4.2.1 | Everyone | Not yet tested |
| Nyanu Kafe | 1.4.21.1 | Everyone | Not yet tested |
| Nyra Scans | 1.4.20.1 | Mature | Not yet tested |
| Nyx Scans | 1.4.26.1 | Everyone | Not yet tested |
| OctopusManga | 1.4.51.2 | Mature | Not yet tested |
| Oglaf | 1.4.4.1 | Mature | Not yet tested |
| Oh Joy Sex Toy | 1.4.3.1 | Mature | Not yet tested |
| Omega Scans | 1.4.50.1 | Mature | ✅ Tested |
| Omoi | 1.4.2.2 | Mature | Not yet tested |
| One Punch Man Online | 1.4.2.1 | Everyone | Not yet tested |
| OneManga.info | 1.4.35.4 | Mature | Not yet tested |
| Only The Best Hentai | 1.4.1.1 | Mature | Not yet tested |
| oots | 1.4.3.1 | Everyone | Not yet tested |
| Oppai Stream | 1.4.5.1 | Mature | Not yet tested |
| Orchisasia | 1.4.51.2 | Mature | Not yet tested |
| Orion Scans | 1.4.23.1 | Everyone | Not yet tested |
| Paradise Scans | 1.4.20.1 | Mature | Not yet tested |
| Paritehaber | 1.4.52.2 | Mature | Not yet tested |
| Patch Friday | 1.4.2.1 | Everyone | Not yet tested |
| Paw Manga | 1.4.51.2 | Mature | Not yet tested |
| Petrotechsociety | 1.4.51.2 | Mature | Not yet tested |
| Philia Scans | 1.4.58.2 | Everyone | Not yet tested |
| PornComix | 1.4.49.1 | Mature | Not yet tested |
| Qi Scans | 1.4.26.1 | Everyone | Not yet tested |
| Questionable Content | 1.4.10.1 | Everyone | Not yet tested |
| Rackus | 1.4.39.1 | Everyone | Not yet tested |
| Rage Scans | 1.4.33.1 | Everyone | Not yet tested |
| Randowiz | 1.4.2.1 | Everyone | Not yet tested |
| Raven Scans | 1.4.34.1 | Mature | Not yet tested |
| Razure | 1.4.32.1 | Everyone | Not yet tested |
| RD Scans | 1.4.51.2 | Everyone | Not yet tested |
| Read Attack on Titan Shingeki no Kyojin Manga | 1.4.13.1 | Everyone | Not yet tested |
| Read Berserk Manga | 1.4.8.1 | Everyone | Not yet tested |
| Read Black Clover Manga Online | 1.4.8.1 | Everyone | Not yet tested |
| Read Boku no Hero Academia My Hero Academia Manga | 1.4.10.1 | Everyone | Not yet tested |
| Read Chainsaw Man Manga Online | 1.4.9.1 | Mature | Not yet tested |
| Read Comics Online | 1.4.14.1 | Everyone | Not yet tested |
| Read Fairy Tail & Edens Zero Manga Online | 1.4.9.1 | Everyone | Not yet tested |
| Read Jujutsu Kaisen Manga Online | 1.4.9.1 | Everyone | Not yet tested |
| Read Kingdom Manga Online | 1.4.8.1 | Everyone | Not yet tested |
| Read Nanatsu no Taizai 7 Deadly Sins Manga Online | 1.4.10.1 | Everyone | Not yet tested |
| Read Naruto Boruto Samurai 8 Manga Online | 1.4.9.1 | Everyone | Not yet tested |
| Read One Piece Manga Online | 1.4.8.1 | Everyone | Not yet tested |
| Read One-Punch Man Manga Online | 1.4.8.1 | Everyone | Not yet tested |
| Read Solo Leveling Manga Manhwa Online | 1.4.10.1 | Everyone | Not yet tested |
| Read Tokyo Ghoul Re & Tokyo Ghoul Manga Online | 1.4.11.1 | Everyone | Not yet tested |
| Read Vagabond Manga | 1.4.1.1 | Everyone | Not yet tested |
| ReadAllComics | 1.4.8.1 | Everyone | Not yet tested |
| ReadComicOnline | 1.4.43.1 | Everyone | Not yet tested |
| Real Life Comics | 1.4.3.1 | Everyone | Not yet tested |
| ReiManga | 1.4.1.1 | Mature | Not yet tested |
| Renascans | 1.4.23.1 | Everyone | Not yet tested |
| Reset Scans | 1.4.65.2 | Everyone | Not yet tested |
| Rest Scans | 1.4.32.1 | Mature | Not yet tested |
| Revival Scans | 1.4.1.1 | Mature | Not yet tested |
| Rinko Comics | 1.4.2.1 | Everyone | ✅ Tested |
| RitharScans | 1.4.23.1 | Everyone | Not yet tested |
| Rizz Comic | 1.4.45.1 | Everyone | Not yet tested |
| Rizz Comic (unoriginal) | 1.4.32.1 | Everyone | Not yet tested |
| RokariComics | 1.4.34.1 | Everyone | Not yet tested |
| Rolia Scan | 1.4.8.1 | Everyone | Not yet tested |
| Rose Squad Scans | 1.4.52.2 | Mature | Not yet tested |
| Ryumanga | 1.4.20.1 | Everyone | Not yet tested |
| S2Manga | 1.4.55.2 | Mature | Not yet tested |
| Sabrina Online | 1.4.1.1 | Everyone | Not yet tested |
| SACACHISPA | 1.4.1.1 | Mature | Not yet tested |
| Sana Scans | 1.4.23.1 | Everyone | Not yet tested |
| Saturday Morning Breakfast Comics | 1.4.2.1 | Everyone | Not yet tested |
| ScansGG | 1.4.1.1 | Mature | Not yet tested |
| Schlock Mercenary | 1.4.2.1 | Everyone | Not yet tested |
| Scythe Scans | 1.4.39.1 | Everyone | Not yet tested |
| Setsu Scans | 1.4.54.2 | Everyone | Not yet tested |
| Shiba Manga | 1.4.51.2 | Mature | Not yet tested |
| Siren Scans | 1.4.20.1 | Everyone | Not yet tested |
| Sky Manga | 1.4.33.1 | Mature | Not yet tested |
| Sleepy Translations | 1.4.52.2 | Everyone | Not yet tested |
| Solar and Sundry | 1.4.2.1 | Everyone | Not yet tested |
| Spmanhwa | 1.4.51.2 | Everyone | Not yet tested |
| SpyFakku | 1.4.15.1 | Mature | Not yet tested |
| StoneScape | 1.4.49.1 | Everyone | Not yet tested |
| Sunshine Butterfly Scans | 1.4.39.2 | Mature | Not yet tested |
| SUPER MEGA | 1.4.4.1 | Everyone | Not yet tested |
| Swords Comic | 1.4.5.1 | Everyone | Not yet tested |
| Tapas | 1.4.24.1 | Mature | Not yet tested |
| TCB Scans | 1.4.12.1 | Everyone | Not yet tested |
| TCB Scans (Unoriginal) | 1.4.32.1 | Everyone | Not yet tested |
| Team Shadowi | 1.4.1.1 | Mature | Not yet tested |
| Temple Scan | 1.4.49.1 | Mature | Not yet tested |
| The Blank | 1.4.56.12 | Mature | ✅ Tested |
| The Duck Webcomics | 1.4.3.1 | Mature | Not yet tested |
| The Property of Hate | 1.4.5.1 | Everyone | Not yet tested |
| TimelessToons | 1.4.20.1 | Everyone | Not yet tested |
| TodayManga | 1.4.3.1 | Mature | Not yet tested |
| Toon18 | 1.4.51.2 | Mature | Not yet tested |
| ToonGod | 1.4.56.4 | Mature | Not yet tested |
| Toonily | 1.4.65.2 | Mature | Not yet tested |
| Toonily.me | 1.4.24.1 | Mature | Not yet tested |
| TooniTube | 1.4.24.1 | Mature | Not yet tested |
| Toonizy | 1.4.51.2 | Mature | Not yet tested |
| Top Manhua | 1.4.58.2 | Mature | Not yet tested |
| TopManhua.fan | 1.4.51.2 | Mature | Not yet tested |
| TopManhua.net | 1.4.51.2 | Mature | Not yet tested |
| TritiniaScans | 1.4.55.2 | Everyone | Not yet tested |
| Utoon | 1.4.55.2 | Everyone | ✅ Tested |
| Valir Scans | 1.4.22.1 | Everyone | Not yet tested |
| Vanilla Scans | 1.4.23.1 | Everyone | Not yet tested |
| vgperson | 1.4.7.1 | Everyone | Not yet tested |
| Violet Scans | 1.4.35.1 | Everyone | Not yet tested |
| VIZ | 1.4.25.4 | Everyone | Not yet tested |
| Vortex Scans | 1.4.61.1 | Everyone | ✅ Tested |
| Voyce.Me | 1.4.6.1 | Everyone | Not yet tested |
| VyvyManga | 1.4.40.1 | Mature | ✅ Tested |
| VyvyManga.org | 1.4.51.2 | Mature | Not yet tested |
| War For Rayuba | 1.4.3.1 | Everyone | Not yet tested |
| Webcomics | 1.4.10.1 | Everyone | Not yet tested |
| Webdex Scans | 1.4.52.1 | Everyone | Not yet tested |
| WebNovel | 1.4.13.1 | Everyone | Not yet tested |
| WebtoonScan | 1.4.51.2 | Mature | Not yet tested |
| WebtoonXYZ | 1.4.55.2 | Mature | Not yet tested |
| Weeb Central | 1.4.22.1 | Mature | Not yet tested |
| Whale Manga | 1.4.51.2 | Mature | Not yet tested |
| WitchScans | 1.4.32.1 | Everyone | Not yet tested |
| WoopRead | 1.4.52.2 | Everyone | Not yet tested |
| Writer Scans | 1.4.20.1 | Everyone | Not yet tested |
| WuxiaWorld | 1.4.52.2 | Everyone | Not yet tested |
| XlecX | 1.4.1.1 | Mature | Not yet tested |
| XoManga | 1.4.1.1 | Mature | Not yet tested |
| XOXO Comics | 1.4.13.1 | Everyone | Not yet tested |
| Xscans | 1.4.1.1 | Everyone | Not yet tested |
| YakshaComics | 1.4.53.2 | Everyone | Not yet tested |
| YaoiHot | 1.4.1.1 | Mature | Not yet tested |
| Yaoihub | 1.4.53.2 | Mature | Not yet tested |
| YaoiScan | 1.4.51.2 | Mature | Not yet tested |
| YaoiToon | 1.4.48.1 | Mature | Not yet tested |
| Yorai | 1.4.2.1 | Everyone | Not yet tested |
| Zazamanga | 1.4.52.2 | Mature | Not yet tested |
| ZinChanManga | 1.4.54.2 | Mature | Not yet tested |
| ZinChanManga.com | 1.4.54.2 | Mature | Not yet tested |
| Zinmanga | 1.4.54.2 | Mature | Not yet tested |
| Zinmanga.net | 1.4.51.2 | Everyone | Not yet tested |

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
  secretstream image layer can't be reproduced in the runtime and remains a
  documented limitation. Browsing, search, details and chapter lists work for all
  of these.
- These extensions are **not affiliated** with the source websites. They only
  scrape publicly available pages.

## Credits

- [Paperback](https://github.com/Paperback-iOS/app) for the app and extension SDK.
- [keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source)
  for the original Tachiyomi sources and icons.
