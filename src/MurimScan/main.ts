import { ContentRating } from "@paperback/types";
import { ZeistMangaExtension } from "../utils/zeistmanga/template";

export const MurimScan = new ZeistMangaExtension({
  name: "MurimScan",
  baseUrl: "https://www.murimscans.site",
  popularMangaSelector: ".PopularPosts article",
  popularMangaSelectorTitle: ".post-title a",
  mangaDetailsSelector: "main",
  mangaDetailsSelectorGenres: "dl.flex:contains(Genre) a[rel=tag], dl.flex:contains(Type) a[rel=tag]",
  mangaDetailsSelectorInfo: "dl.flex",
  mangaDetailsSelectorInfoTitle: "dt",
  mangaDetailsSelectorInfoDescription: "dd",
  pageListSelector: ".chapter-raw-content, .post-body, .check-box",
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
