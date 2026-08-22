import { ContentRating, SourceManga } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

/**
 * Eva Scans runs a customised MangaThemesia theme ("premium" layout) whose
 * details markup differs from the stock one, so the synopsis, poster, genres
 * and status all come from bespoke classes. Upstream #18404 pointed the
 * selectors at the new markup and rebuilt the description to include the site's
 * Rating / Views stats and alternative names.
 */
class EvaScansExtension extends MangaThemesiaExtension {
  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const base = await super.getMangaDetails(mangaId);

    const slug = await this.resolveMangaSlug(mangaId);
    const $ = await this.fetchCheerio({
      url: `${this.baseUrl}/${this.mangaUrlDirectory}/${slug}`,
      method: "GET",
    });

    // `.stat-v-box` holds label/value pairs (Rating, Type, Status, Views).
    // Jsoup's `:containsOwn` has no cheerio equivalent, so read the boxes
    // imperatively into a map instead of selecting by label text.
    const stats = new Map<string, string>();
    $(".stat-v-box").each((_, el) => {
      const box = $(el);
      const label = box.find(".stat-v-label").first().text().trim();
      const value = box.find(".stat-v-value").first().text().trim();
      if (label) stats.set(label, value);
    });

    // Prefer the expanded synopsis, then the collapsed one, then the meta tag.
    let synopsis = "";
    const full = $(".synopsis-full").first();
    if (full.length > 0) {
      const paras: string[] = [];
      full.find("p").each((_, el) => {
        const t = $(el).text().trim();
        if (t) paras.push(t);
      });
      synopsis = paras.join("\n\n");
    }
    if (!synopsis) synopsis = $(".synopsis-short p").first().text().trim();
    if (!synopsis) {
      synopsis = ($("meta[name=description]").first().attr("content") ?? "").trim();
    }

    const altNames = $(".series-title-alt")
      .first()
      .text()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const parts: string[] = [];
    const rating = parseFloat(stats.get("Rating") ?? "");
    if (!isNaN(rating) && rating > 0) parts.push(`Rating: ${rating.toFixed(2)}/10`);
    const views = stats.get("Views");
    if (views) parts.push(`Views: ${views}`);
    if (synopsis) parts.push(`Synopsis: ${synopsis}`);
    if (altNames.length > 0) {
      parts.push(
        "Alternative Names:\n" + altNames.map((n) => `- ${n}`).join("\n"),
      );
    }

    const description = parts.join("\n\n");
    const status = stats.get("Status");

    return {
      ...base,
      mangaInfo: {
        ...base.mangaInfo,
        synopsis: description || base.mangaInfo.synopsis,
        secondaryTitles:
          altNames.length > 0 ? altNames : base.mangaInfo.secondaryTitles,
        status: status ? this.parseStatus(status) : base.mangaInfo.status,
      },
    };
  }
}

export const EvaScans = new EvaScansExtension({
  name: "Eva Scans",
  baseUrl: "https://evascans.org",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  // Upstream #18404 selectors for the redesigned "premium" details layout.
  seriesDetailsSelector: ".series-premium-header",
  seriesTitleSelector: ".series-title-main",
  seriesThumbnailSelector: ".series-poster-premium img, .poster-box img",
  seriesGenreSelector: ".series-genres-wrap .gen-tag",
  seriesAltNameSelector: ".series-title-alt",
  // Fix page reading - site uses a custom reader with a camelCase ID.
  pageSelector: "div#readerArea img",
});
