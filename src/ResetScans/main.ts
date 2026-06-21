import { Chapter, ContentRating, SourceManga } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

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

class ResetScansExtension extends MadaraExtension {
  /**
   * Faithful port of the upstream `chapterListParse` override.
   *
   * Reset Scans emits chapter release dates in a `dd-MMM` format with no year
   * (parsed by upstream via `SimpleDateFormat("dd-MMM", Locale.US)` in UTC),
   * which leaves the parsed date stuck in year 1970. The override walks the
   * chapter list (newest-first DOM order) and infers the correct year:
   *   - For year-less (1970) dates: if the month jumps forward by >= 6 months
   *     relative to the previous chapter (e.g. Jan -> Dec going backwards in
   *     time), we crossed into the previous year, so decrement. For the first
   *     such date, if assigning the current year would put it more than a week
   *     in the future, it belongs to last year instead.
   *   - Dates that already carry a valid year reset the tracking variables.
   */
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = await super.getChapters(sourceManga);

    let currentYear = new Date().getUTCFullYear();
    let previousMonth = -1;

    for (const chapter of chapters) {
      const ms = chapter.publishDate?.getTime();
      if (ms === undefined || !(ms > 0)) {
        continue;
      }

      const date = new Date(ms);

      // 1970 (UTC) means the date was parsed without a year.
      if (date.getUTCFullYear() === 1970) {
        const month = date.getUTCMonth();

        if (previousMonth !== -1) {
          // Month jumping forward (e.g. Jan to Dec) means we crossed into the
          // previous year.
          if (month - previousMonth >= 6) {
            currentYear--;
          }
        } else {
          // If the first parsed date is in the future (+7 day buffer), it
          // belongs to last year.
          date.setUTCFullYear(currentYear);
          if (date.getTime() > Date.now() + 604_800_000) {
            currentYear--;
          }
        }

        date.setUTCFullYear(currentYear);
        chapter.publishDate = date;

        previousMonth = month;
      } else {
        // Update tracking variables using dates that already have a valid year.
        currentYear = date.getUTCFullYear();
        previousMonth = date.getUTCMonth();
      }
    }

    return chapters;
  }

  /**
   * Parse the site's `dd-MMM` chapter dates (e.g. "15-Jan") into a UTC date in
   * year 1970, mirroring upstream's `SimpleDateFormat("dd-MMM", Locale.US)`
   * with a UTC time zone. Other date formats (relative "x ago", today, etc.)
   * fall through to the base implementation.
   */
  protected override parseDate(dateText: string): Date {
    const text = (dateText || "").trim();
    const match = text.match(/^(\d{1,2})-([A-Za-z]{3,})$/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
      if (month !== undefined && !isNaN(day)) {
        // Year 1970 UTC; year is inferred later in getChapters.
        return new Date(Date.UTC(1970, month, day));
      }
    }
    return super.parseDate(text);
  }
}

export const ResetScans = new ResetScansExtension({
  name: "Reset Scans",
  baseUrl: "https://reset-scans.org",
  useNewChapterEndpoint: true,
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
