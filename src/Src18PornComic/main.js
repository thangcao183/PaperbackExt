import { ContentRating } from "@paperback/types";
import { Manga18Extension } from "../utils/manga18/template";
export const Src18PornComic = new Manga18Extension({
    name: "18 Porn Comic",
    baseUrl: "https://18porncomic.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
