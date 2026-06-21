import { Chapter, ContentRating, SourceManga } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";

class MangaBlazeExtension extends MadaraExtension {
  // Upstream `chapterFromElement`: the list element itself is the anchor
  // (`a.nxv3-card`), the chapter URL is the element's own href (no
  // `?style=list` suffix), and the title comes from a nested
  // `.zax-chapter-title` span rather than the anchor's own text.
  // Upstream defines no chapter date, so dates default to the epoch.
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const mangaUrl = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();

    let $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
    let chapterElements = $(this.chapterListSelector);

    if (chapterElements.length === 0) {
      try {
        const ajax = await this.fetchCheerio({
          url: `${mangaUrl}/ajax/chapters`,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            referer: `${mangaUrl}/`,
            "x-requested-with": "XMLHttpRequest",
          },
        });
        if (ajax(this.chapterListSelector).length > 0) {
          $ = ajax;
          chapterElements = ajax(this.chapterListSelector);
        }
      } catch {
        // ignore, fall through with whatever we have
      }
    }

    const chapters: Chapter[] = [];
    chapterElements.each((_, element) => {
      const el = $(element);
      // The element is itself the `<a>` (a.nxv3-card).
      const href = el.attr("href") || "";
      if (!href) return;

      const chapterTitle = el.find(".zax-chapter-title").first().text().trim();
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

      chapters.push({
        chapterId,
        sourceManga,
        title: chapterTitle,
        volume: 0,
        chapNum,
        publishDate: new Date(0),
        langCode: this.langCode,
      });
    });

    return chapters;
  }
}

export const MangaBlaze = new MangaBlazeExtension({
  name: "MangaBlaze",
  baseUrl: "https://mangablaze.com",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaDetailsDescriptionSelector: ".nbu-summary__body",
  mangaDetailsThumbnailSelector: "img.nbu-hero__img",
  mangaDetailsTitleSelector: "h1.nbu-hero__title, h1#nbu-hero-title",
  popularMangaUrlSelector: "h3.x72-title a",
  searchMangaUrlSelector: "h2.z8x-card__title a",
  // Upstream `chapterListSelector()` override.
  chapterListSelector: "a.nxv3-card:not(.zax-chapter-premium)",
  // Upstream `chapterFromElement` uses the element href verbatim with no
  // `?style=list` suffix, so chapter pages are opened without it.
  chapterUrlSuffix: "",
});
