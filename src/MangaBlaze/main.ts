import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";

export const MangaBlaze = new MadaraExtension({
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
});
