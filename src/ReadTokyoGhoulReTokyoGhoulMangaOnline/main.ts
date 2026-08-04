import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadTokyoGhoulReTokyoGhoulMangaOnline = new MangaCatalogExtension({
  name: "Read Tokyo Ghoul Re & Tokyo Ghoul Manga Online",
  baseUrl: "https://ww12.tokyoghoulre.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Tokyo Ghoul", url: "/manga/tokyo-ghoul/" },
    { title: "Tokyo Ghoul Jack", url: "/manga/tokyo-ghoul-jack/" },
    { title: "Tokyo Ghoul: re Colored", url: "/manga/tokyo-ghoulre-colored/" },
    { title: "Gorilla", url: "/manga/this-gorilla-will-die-in-1-day/" },
    { title: "Zakki", url: "/manga/tokyo-ghoul-zakki/" },
    { title: "Light Novel", url: "/manga/tokyo-ghoul-re-light-novels/" },
    { title: "Choujin X", url: "/manga/choujin-x/" },
    { title: "Tokyo Ghoul re", url: "/manga/tokyo-ghoulre/" },
  ],
});
