import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadAttackOnTitanShingekiNoKyojinManga = new MangaCatalogExtension({
  name: "Read Attack on Titan Shingeki no Kyojin Manga",
  baseUrl: "https://ww11.readsnk.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  chapterVariant: "gridCol",
  mangaList: [
    { title: "Shingeki No Kyojin", url: "/manga/shingeki-no-kyojin/" },
    { title: "Colored", url: "/manga/shingeki-no-kyojin-colored/" },
    { title: "Before the Fall", url: "/manga/shingeki-no-kyojin-before-the-fall/" },
    { title: "Lost Girls", url: "/manga/shingeki-no-kyojin-lost-girls/" },
    { title: "No Regrets", url: "/manga/attack-on-titan-no-regrets/" },
    { title: "Junior High", url: "/manga/attack-on-titan-junior-high/" },
    { title: "Guidebook", url: "/manga/attack-on-titan-guidebook-inside-outside/" },
    { title: "Harsh Mistress", url: "/manga/attack-on-titan-harsh-mistress-of-the-city/" },
    { title: "Anthology", url: "/manga/attack-on-titan-anthology/" },
    { title: "Art Book", url: "/manga/attack-on-titan-exclusive-art-book/" },
    { title: "Spoof", url: "/manga/spoof-on-titan/" },
    { title: "No Regrets Colored", url: "/manga/attack-on-titan-no-regrets-colored/" },
    { title: "BTF Light Novel", url: "/manga/attack-on-titan-before-the-fall-light-novel/" },
    { title: "Best of SNK", url: "/manga/the-best-of-attack-on-titan-in-color/" },
  ],
});
