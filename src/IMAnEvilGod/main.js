import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";
export const IMAnEvilGod = new MangaCatalogExtension({
    name: "I'm An Evil God",
    baseUrl: "https://imanevilgod.com",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    detailVariant: "meta",
    chapterVariant: "links",
    pageVariant: "entryContent",
    mangaList: [
        { title: "I'm An Evil God", url: "/" },
    ],
});
