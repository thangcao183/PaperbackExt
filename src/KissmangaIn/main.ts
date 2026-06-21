import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

/**
 * Kissmanga.in serves listing/search anchors with trailing query strings
 * (e.g. `/kissmanga/<slug>?...`). Upstream strips these in
 * popularMangaFromElement / latestUpdatesFromElement / searchMangaFromElement
 * via `url.substringBefore("?")`. The Paperback template derives the mangaId
 * straight from the anchor href, and its `/<mangaSubString>/([^/]+)` capture
 * would otherwise fold the query string into the slug. Stripping the query
 * here reproduces that behavior for every listing parser at once.
 *
 * The other upstream overrides need no code:
 * - chapterFromElement strips `?` then re-adds `?style=list`; the template
 *   already drops the query in parseChapterId and re-appends `?style=list`
 *   via the default chapterUrlSuffix.
 * - imageFromElement only `.trim()`s the result; the template's
 *   imageFromElement already trims.
 */
class KissmangaInExtension extends MadaraExtension {
  protected override parseMangaId(href: string): string {
    return super.parseMangaId(href.replace(/\?.*$/, ""));
  }
}

export const KissmangaIn = new KissmangaInExtension({
  name: "Kissmanga.in",
  baseUrl: "https://kissmanga.in",
  mangaSubString: "kissmanga",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
