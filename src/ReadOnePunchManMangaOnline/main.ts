import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadOnePunchManMangaOnline = new MangaCatalogExtension({
  name: "Read One-Punch Man Manga Online",
  baseUrl: "https://ww6.readopm.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  detailVariant: "card",
  chapterVariant: "table",
  mangaList: [
    { title: "One Punch Man", url: "/manga/one-punch-man/" },
    { title: "Official", url: "/manga/one-punch-man-official/" },
    { title: "Onepunch-Man (ONE)", url: "/manga/onepunch-man-one/" },
    { title: "Colored", url: "/manga/one-punch-man-colored/" },
    { title: "Mob Psycho 100", url: "/manga/mob-psycho-100/" },
    { title: "Reigen", url: "/manga/reigen/" },
    { title: "Versus (ONE)", url: "/manga/versus/" },
    { title: "Bug Ego", url: "/manga/bug-ego/" },
    { title: "Eyeshield 21", url: "/manga/eyeshield-21/" },
  ],
});
