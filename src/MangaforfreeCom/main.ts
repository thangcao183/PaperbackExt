import { ChapterDetails, ContentRating, Chapter } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

class MangaforfreeComExtension extends MadaraExtension {
  // Upstream override: pageListParse maps each page image URL,
  // rewriting `http://` to `https://`.
  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const details = await super.getChapterDetails(chapter);
    const basePages = "pages" in details ? details.pages : [];
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: basePages.map((page: string) =>
        page.replace("http://", "https://"),
      ),
    };
  }
}

export const MangaforfreeCom = new MangaforfreeComExtension({
  name: "Mangaforfree.com",
  baseUrl: "https://mangaforfree.com",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
