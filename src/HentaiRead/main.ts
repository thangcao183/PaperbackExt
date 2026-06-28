import {
  Chapter,
  ChapterDetails,
  ContentRating,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SortingOption,
  SourceManga,
} from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";

// Page-list JSON, base64-decoded from `window.m... = 'eyJkYX...'`.
type PagesDto = {
  data: {
    chapter: {
      images: { src: string }[];
    };
  };
};

// `chapterExtraData = ({ "baseUrl": "..." })` from the `single-chapter-js-extra` script.
type ImageBaseUrlDto = {
  baseUrl: string;
};

type SearchMetadata = {
  page?: number;
  searchCollectedIds?: string[];
};

class HentaiReadExtension extends MadaraExtension {
  // chapterExtraData = ({...});
  private readonly chapterExtraDataRegex = /= (\{[^;]+)/;
  // window.mMjM5MjM2 = '(eyJkYX...);
  private readonly pagesDataRegex = /.(ey\S+).\s/;

  // ----------------------------------------------------------------
  // Manga details (upstream `mangaDetailsParse`)
  // ----------------------------------------------------------------

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(mangaId)
      .build();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    const capitalizeEach = (s: string): string =>
      s
        .split(" ")
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ");

    const eachText = (selector: string): string[] => {
      const out: string[] = [];
      $(selector).each((_, el) => {
        const t = $(el).text().trim();
        out.push(t);
      });
      return out;
    };

    const title = $(this.mangaDetailsTitleSelector).first().text().trim();

    const authors = eachText("a[href*=/circle/] span:first-of-type").join(", ");
    const artists = eachText("a[href*=/artist/] span:first-of-type").join(", ");
    const genres = eachText("a[href*=/tag/] span:first-of-type");

    const characters = eachText(
      "a[href*=/characters/] span:first-of-type",
    ).join(", ");
    const parodies = eachText("a[href*=/parody/] span:first-of-type").join(
      ", ",
    );
    const circles = eachText("a[href*=/circle/] span:first-of-type").join(", ");
    const conventions = eachText(
      "a[href*=/convention/] span:first-of-type",
    ).join(", ");
    const scanlators = eachText("a[href*=/scanlator/] span:first-of-type").join(
      ", ",
    );

    let description = "";
    if (characters) {
      description += `Characters: ${capitalizeEach(characters)}\n\n`;
    }
    if (parodies) {
      description += `Parodies: ${capitalizeEach(parodies)}\n\n`;
    }
    if (circles) {
      description += `Circles: ${capitalizeEach(circles)}\n\n`;
    }
    if (conventions) {
      description += `Convention: ${capitalizeEach(conventions)}\n\n`;
    }
    if (scanlators) {
      description += `Scanlators: ${capitalizeEach(scanlators)}\n\n`;
    }

    const altTitlesText = $(".manga-titles h2").first().text();
    const secondaryTitles: string[] = [];
    if (altTitlesText) {
      const parts = altTitlesText.split("|").map((t) => t.trim());
      description += `Alternative Titles: \n${parts
        .map((t) => `- ${t}`)
        .join("\n")}\n\n`;
      for (const p of parts) {
        if (p) secondaryTitles.push(p);
      }
    }
    description += `${$(".items-center:contains(pages:)").text()}\n`;

    const image = this.imageFromElement(
      $(this.mangaDetailsThumbnailSelector ?? "div.summary_image img").first(),
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: title,
        secondaryTitles,
        thumbnailUrl: image,
        author: authors || artists || undefined,
        artist: artists || authors || undefined,
        synopsis: description,
        rating: 0,
        contentRating: this.contentRating,
        status: "Completed",
        tagGroups:
          genres.length > 0
            ? [
                {
                  id: "genres",
                  title: "Genres",
                  tags: genres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                  })),
                },
              ]
            : [],
        shareUrl: url,
      },
    };
  }

  // ----------------------------------------------------------------
  // Chapters (upstream `fetchChapterList`)
  //
  // The site exposes each entry as a single "chapter" pointing back at the
  // manga URL; the scanlator is lifted out of the description text.
  // ----------------------------------------------------------------

  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const synopsis = sourceManga.mangaInfo.synopsis ?? "";
    let title = "Chapter";
    if (synopsis.includes("Scanlators")) {
      const scan = synopsis.split("Scanlators: ")[1]?.split("\n")[0]?.trim();
      if (scan) title = scan;
    }

    return [
      {
        chapterId: sourceManga.mangaId,
        sourceManga,
        title,
        volume: 0,
        chapNum: 1,
        publishDate: new Date(),
        langCode: this.langCode,
      },
    ];
  }

  // ----------------------------------------------------------------
  // Chapter details (upstream `pageListRequest` + `pageListParse`)
  //
  // Page URL is `{mangaUrl}english/p/1/`. The image base URL and the
  // base64-encoded page list are embedded in inline scripts.
  // ----------------------------------------------------------------

  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaUrl = new URLBuilder(this.baseUrl)
      .addPath(this.mangaSubString)
      .addPath(chapter.sourceManga.mangaId)
      .build();
    // There's like 2 non-English entries where this breaks.
    const url = `${mangaUrl}/english/p/1/`;

    const $ = await this.fetchCheerio({ url, method: "GET" });

    const extraData = $("[id=single-chapter-js-extra]").first().text();
    const baseMatch = this.chapterExtraDataRegex.exec(extraData);
    let pageBaseUrl = "";
    if (baseMatch?.[1]) {
      const dto = JSON.parse(baseMatch[1]) as ImageBaseUrlDto;
      pageBaseUrl = dto.baseUrl;
    }

    const beforeData = $("[id=single-chapter-js-before]").first().text();
    const pagesMatch = this.pagesDataRegex.exec(beforeData);
    if (!pagesMatch?.[1]) {
      throw new Error(
        "Failed to find page list. Non-English entries are not supported.",
      );
    }
    const decoded = Application.base64Decode(pagesMatch[1]);
    const decodedStr =
      typeof decoded === "string"
        ? decoded
        : Application.arrayBufferToUTF8String(decoded);
    const pagesDto = JSON.parse(decodedStr) as PagesDto;

    const pages = pagesDto.data.chapter.images.map(
      (img) => `${pageBaseUrl}/${img.src}`,
    );

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // ----------------------------------------------------------------
  // Search (upstream `searchMangaRequest` + `searchMangaParse`)
  //
  // searchMangaParse delegates to popularMangaParse, so results use the
  // `.manga-item` container with the `a.manga-item__link` anchor. The
  // request builds `{baseUrl}/page/{page}?s=query&title-type=contains`.
  // ----------------------------------------------------------------

  override async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = metadata as SearchMetadata | undefined;
    const page = meta?.page ?? 1;
    const collectedIds = meta?.searchCollectedIds ?? [];
    const titleQuery = (query.title || "").trim();

    const url = new URLBuilder(this.baseUrl)
      .addPath("page")
      .addPath(page.toString())
      .addQuery("s", encodeURIComponent(titleQuery))
      .addQuery("title-type", "contains")
      .build();

    const $ = await this.fetchCheerio({ url, method: "GET" });
    const results: SearchResultItem[] = [];

    $(".manga-item").each((_, element) => {
      const unit = $(element);
      const titleLink = unit.find(this.popularMangaUrlSelector).first();
      const title = titleLink.text().trim() || titleLink.attr("title") || "";
      const href = titleLink.attr("href") || "";
      const mangaId = this.parseMangaId(href);
      const image = this.imageFromElement(unit.find("img").first());

      if (title && mangaId && !collectedIds.includes(mangaId)) {
        collectedIds.push(mangaId);
        results.push({
          mangaId,
          imageUrl: image,
          title,
          subtitle: undefined,
          metadata: undefined,
        });
      }
    });

    // Upstream popular/search next-page selector is `a[rel=next]`.
    const hasNextPage = $("a[rel=next]").length > 0;
    const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;

    return {
      items: results,
      metadata:
        hasNextPage && !reachedPageLimit
          ? { page: page + 1, searchCollectedIds: collectedIds }
          : undefined,
    };
  }
}

export const HentaiRead = new HentaiReadExtension({
  name: "HentaiRead",
  baseUrl: "https://hentairead.com",
  mangaSubString: "hentai",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
  popularMangaUrlSelector: "a.manga-item__link",
  discoverItemSelector: ".manga-item",
});
