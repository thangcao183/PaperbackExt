import { Chapter, ContentRating, SourceManga } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

class ZinmangaExtension extends MadaraExtension {
  // Faithful port of upstream chapterListParse + chapterFromElement.
  //
  // Upstream chapterListParse adds a third-tier fallback that the base
  // template lacks: when both the inline list and the modern
  // `{mangaUrl}/ajax/chapters` endpoint return no chapters, it reads the
  // `input.rating-post-id` value and POSTs `manga_get_chapters` to the legacy
  // `wp-admin/admin-ajax.php` endpoint. Upstream chapterFromElement only
  // strips the domain from the chapter URL (the base `parseChapterId` already
  // stores relative slugs), so there is nothing further to reproduce there.
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = await super.getChapters(sourceManga);
    if (chapters.length > 0) {
      return chapters;
    }

    const mangaId = sourceManga.mangaId;
    const mangaUrl = `${this.baseUrl}/${this.mangaSubString}/${mangaId}`;

    // Read the post id used to look the manga up via the legacy endpoint.
    const $page = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    const ratingPostId = $page("input.rating-post-id").first().attr("value");
    if (!ratingPostId) {
      return chapters;
    }

    const body = [
      ["action", "manga_get_chapters"],
      ["manga", ratingPostId],
    ]
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    let $;
    try {
      $ = await this.fetchCheerio({
        url: `${this.baseUrl}/wp-admin/admin-ajax.php`,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: `${this.baseUrl}/`,
          "x-requested-with": "XMLHttpRequest",
        },
        body,
      });
    } catch {
      return chapters;
    }

    const result: Chapter[] = [];
    $(this.chapterListSelector).each((_, element) => {
      const el = $(element);
      const link = el.find("a").first();
      const href = link.attr("href") || "";
      if (!href) return;

      const chapterTitle = link.text().trim();
      const chapterId = this.parseChapterId(href, mangaId);
      if (!chapterId) return;

      let chapNum = 0;
      const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
      if (numMatch) {
        chapNum = parseFloat(numMatch[1]);
      } else {
        const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
        if (slugMatch) chapNum = parseFloat(slugMatch[1].replace("-", "."));
      }

      const dateText = el.find("span.chapter-release-date").text().trim();
      const publishDate = this.parseDate(dateText);

      result.push({
        chapterId,
        sourceManga,
        title: chapterTitle,
        volume: 0,
        chapNum,
        publishDate,
        langCode: this.langCode,
      });
    });

    return result;
  }
}

export const Zinmanga = new ZinmangaExtension({
  name: "Zinmanga",
  baseUrl: "https://mangazin.org",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  filterNonMangaItems: false,
  chapterUrlSuffix: "",
});
