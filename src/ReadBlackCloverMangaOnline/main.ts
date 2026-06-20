import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadBlackCloverMangaOnline = new MangaCatalogExtension({
  name: "Read Black Clover Manga Online",
  baseUrl: "https://ww10.readblackclover.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Black Clover", url: "/manga/black-clover/" },
    { title: "Fan Colored", url: "/manga/black-clover-colored/" },
    { title: "Hungry Joker", url: "/manga/hungry-joker/" },
    { title: "Gaiden", url: "/manga/black-clover-gaiden-quartet-knights/" },
  ],
});
