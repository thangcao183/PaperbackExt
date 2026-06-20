import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadJujutsuKaisenMangaOnline = new MangaCatalogExtension({
  name: "Read Jujutsu Kaisen Manga Online",
  baseUrl: "https://ww5.readjujutsukaisen.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Jujutsu Kaisen", url: "/manga/jujutsu-kaisen/" },
    { title: "Jujutsu Kaisen 0", url: "/manga/jujutsu-kaisen-0/" },
    { title: "JJK Colored", url: "/manga/jujutsu-kaisen-colored/" },
    { title: "Fan Scan", url: "/manga/jujutsu-kaisen-fan-scan/" },
    { title: "JJK Light Novel", url: "/manga/jujutsu-kaisen-first-light-novel/" },
    { title: "2nd Light Novel", url: "/manga/jujutsu-kaisen-second-light-novel/" },
    { title: "No.9", url: "/manga/no-9/" },
    { title: "Fanbook", url: "/manga/jujutsu-kaisen-official-fanbook/" },
  ],
});
