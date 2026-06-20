import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadBokuNoHeroAcademiaMyHeroAcademiaManga = new MangaCatalogExtension({
  name: "Read Boku no Hero Academia My Hero Academia Manga",
  baseUrl: "https://ww10.readmha.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Boku no Hero Academia", url: "/manga/boku-no-hero-academia/" },
    { title: "Vigilante", url: "/manga/vigilante-boku-no-hero-academia-illegals/" },
    { title: "Team Up", url: "/manga/my-hero-academia-team-up-mission/" },
    { title: "MHA Smash", url: "/manga/boku-no-hero-academia-smash/" },
    { title: "School Brief", url: "/manga/my-hero-academia-school-briefs/" },
    { title: "Rising", url: "/manga/deku-bakugo-rising/" },
    { title: "Colored", url: "/manga/boku-no-hero-academia-colored/" },
    { title: "Oumagadoki Zoo", url: "/manga/oumagadoki-zoo/" },
    { title: "Sensei no Bulge", url: "/manga/sensei-no-bulge/" },
    { title: "Ultra Analysis", url: "/manga/my-hero-academia-ultra-analysis/" },
  ],
});
