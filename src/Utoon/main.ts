import { Chapter, ContentRating, SourceManga, TagSection } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";

/**
 * Utoon migrated from a stock Madara theme to a fully custom theme
 * ("UTOON-ZAX"). The manga-details page no longer uses any of the standard
 * Madara selectors (`div.summary_image img`, `div.post-title h3`,
 * `li.wp-manga-chapter`, ...), so both `getMangaDetails` and `getChapters`
 * must be overridden for the new markup. The reader page, however, still
 * serves classic Madara markup (`div.page-break img.wp-manga-chapter-img`),
 * so `getChapterDetails` (and its default `pageListSelector`) keeps working.
 */
class UtoonExtension extends MadaraExtension {
  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const title = $("h1.htitle").first().text().trim();

    // Alternative titles live in the collapsible "Also known as" list.
    const altTitles: string[] = [];
    $("div.halt-list span.halt-tag").each((_, el) => {
      const t = $(el).text().trim();
      if (t) altTitles.push(t);
    });

    // Thumbnail: the poster <img>, falling back to the hero background image
    // and finally the og:image meta tag.
    let image = this.imageFromElement($("div.poster a img, div.poster img").first());
    if (!image) {
      const heroStyle = $("div.hero__bg").first().attr("style") || "";
      const bgMatch = heroStyle.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
      if (bgMatch) image = bgMatch[1].trim();
    }
    if (!image) {
      image = ($('meta[property="og:image"]').first().attr("content") || "").trim();
    }

    const description = $("div.syn, #syn").first().text().trim();

    // The info grid holds Author / Status / Type / Chapters rows as
    // `<div class="sir"><span class="l">label</span><span class="v">value</span></div>`.
    const info: Record<string, string> = {};
    $("div.sinfo-grid div.sir").each((_, el) => {
      const row = $(el);
      const label = row.find("span.l").text().trim().toLowerCase();
      const value = row.find("span.v").text().trim();
      if (label) info[label] = value;
    });

    const authors: string[] = [];
    if (info["author"] && !/^\d+$/.test(info["author"])) {
      authors.push(info["author"]);
    }

    // Genres + series type.
    const genres: string[] = [];
    $("div.genres a.genre").each((_, el) => {
      const g = $(el).text().trim();
      if (g) genres.push(g);
    });
    if (info["type"]) genres.push(info["type"]);

    const tagGroups: TagSection[] = [];
    const uniqueGenres = [...new Set(genres.map((g) => g.trim()).filter(Boolean))];
    if (uniqueGenres.length > 0) {
      tagGroups.push({
        id: "genres",
        title: "Genres",
        tags: uniqueGenres.map((g) => ({
          id: g.toLowerCase().replace(/\s+/g, "-"),
          title: g,
        })),
      });
    }

    // Rating: the first `.hinfo .hi` reads like "4.2 / 5".
    let rating = 0;
    const ratingText = $("div.hinfo span.hi").first().text().trim();
    const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
    if (ratingMatch) {
      const parsed = parseFloat(ratingMatch[1]);
      if (!isNaN(parsed)) rating = parsed / 5;
    }

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles: altTitles,
        thumbnailUrl: image,
        author: authors.join(", ") || undefined,
        artist: undefined,
        synopsis: description,
        rating,
        contentRating: this.contentRating,
        status: this.parseStatus(info["status"] ?? "Unknown"),
        tagGroups,
        shareUrl: url,
      },
    };
  }

  /**
   * The custom theme embeds the full chapter list as a JSON array
   * (`var CH=[{ id, label, url, ago, locked, coin, num, ... }];`) in the
   * details-page HTML, then renders/paginates it client-side. Parsing the
   * JSON is more reliable than scraping the JS-rendered `a.crow` DOM (only
   * the first page of rows is present in the static HTML).
   *
   * Locked/premium chapters are filtered out to match upstream's
   * `li.wp-manga-chapter:not(.premium-block)` behavior.
   */
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const mangaUrl = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();

    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    const html = $.root().html() ?? "";

    const chapters = this.parseEmbeddedChapters(html, sourceManga, mangaId);
    if (chapters.length > 0) return chapters;

    // Fallback to the stock Madara chapter parsing (AJAX endpoint) if the
    // embedded array is ever absent.
    return super.getChapters(sourceManga);
  }

  private parseEmbeddedChapters(
    html: string,
    sourceManga: SourceManga,
    mangaId: string,
  ): Chapter[] {
    const match = html.match(/var\s+CH\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match) return [];

    type Raw = {
      label?: string;
      url?: string;
      ago?: string;
      locked?: boolean;
      num?: number;
    };

    let raws: Raw[];
    try {
      raws = JSON.parse(match[1]) as Raw[];
    } catch {
      return [];
    }

    const chapters: Chapter[] = [];
    for (const raw of raws) {
      if (!raw || !raw.url) continue;
      if (raw.locked) continue; // skip premium/paid chapters

      const chapterId = this.parseChapterId(raw.url, mangaId);
      if (!chapterId) continue;

      const title = (raw.label ?? "").trim();
      let chapNum = typeof raw.num === "number" ? raw.num : 0;
      if (!chapNum) {
        const numMatch = title.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);
      }

      chapters.push({
        chapterId,
        sourceManga,
        title,
        volume: 0,
        chapNum,
        publishDate: this.parseDate(raw.ago ?? ""),
        langCode: this.langCode,
      });
    }

    return chapters;
  }
}

export const Utoon = new UtoonExtension({
  name: "Utoon",
  baseUrl: "https://utoon.net",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  useLoadMoreRequest: true,
  // Upstream excludes premium chapters from the list.
  chapterListSelector: "li.wp-manga-chapter:not(.premium-block)",
});
