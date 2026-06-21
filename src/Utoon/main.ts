import { Chapter, ContentRating, SourceManga } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const WEEK_MS = 604_800_000;

class UtoonExtension extends MadaraExtension {
  /**
   * Faithful port of upstream Utoon's `chapterListParse`.
   *
   * Upstream parses chapter dates with a `dd MMM` format (no year), so every
   * parsed date defaults to year 1970. It then walks the (newest-first)
   * chapter list and infers the real year for each entry:
   *   - For the first parsed date, it tentatively assigns the current year;
   *     if that lands more than a week in the future it belongs to last year.
   *   - For subsequent dates, a month jumping forward by >= 6 (e.g. Jan -> Dec)
   *     means we crossed back into the previous year, so the year is decremented.
   *
   * The chapter list selector also excludes premium chapters
   * (`li.wp-manga-chapter:not(.premium-block)`).
   */
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

    // First pass: build the chapter list while capturing the raw `dd MMM`
    // date text (the base method discards it via parseDate).
    type Raw = { chapter: Chapter; date: { month: number; day: number } | null };
    const raws: Raw[] = [];

    chapterElements.each((_, element) => {
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
      const dateMatch = dateText.match(/(\d{1,2})\s+([A-Za-z]{3})/);
      let date: { month: number; day: number } | null = null;
      if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const month = MONTHS[dateMatch[2].toLowerCase()];
        if (month !== undefined && !isNaN(day)) {
          date = { month, day };
        }
      }

      raws.push({
        chapter: {
          chapterId,
          sourceManga,
          title: chapterTitle,
          volume: 0,
          chapNum,
          publishDate: new Date(),
          langCode: this.langCode,
        },
        date,
      });
    });

    // Second pass: infer the year for each parsed date.
    let currentYear = new Date().getFullYear();
    let previousMonth = -1;
    const now = Date.now();

    return raws.map(({ chapter, date }) => {
      if (!date) return chapter;

      const { month, day } = date;

      if (previousMonth !== -1) {
        if (month - previousMonth >= 6) {
          currentYear--;
        }
      } else {
        const candidate = new Date(currentYear, month, day).getTime();
        if (candidate > now + WEEK_MS) {
          currentYear--;
        }
      }

      previousMonth = month;

      return {
        ...chapter,
        publishDate: new Date(currentYear, month, day),
      };
    });
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
