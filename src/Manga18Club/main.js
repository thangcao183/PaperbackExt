import { ContentRating } from "@paperback/types";
import { Manga18Extension } from "../utils/manga18/template";
export const Manga18Club = new Manga18Extension({
    name: "Manga18.Club",
    baseUrl: "https://manga18.club",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
