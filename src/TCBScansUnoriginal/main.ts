import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";

export const TCBScansUnoriginal = new MangaThemesiaExtension({
  name: "TCB Scans (Unoriginal)",
  baseUrl: "https://tcbscanonepiecechapters.com",
  mangaUrlDirectory: "/manga",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
