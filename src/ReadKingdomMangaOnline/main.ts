import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadKingdomMangaOnline = new MangaCatalogExtension({
  name: "Read Kingdom Manga Online",
  baseUrl: "https://ww5.readkingdom.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Kingdom", url: "/manga/kingdom/" },
    { title: "Li Mu", url: "/manga/li-mu/" },
    { title: "Meng Wu & Chu Zi", url: "/manga/meng-wu-and-chu-zi-one-shot/" },
  ],
});
