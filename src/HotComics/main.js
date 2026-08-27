import { ContentRating } from "@paperback/types";
import { HotComicsExtension } from "../utils/hotcomics/template";
export const HotComics = new HotComicsExtension({
    name: "HotComics",
    baseUrl: "https://hotcomics.me",
    browseList: [
        {
            "id": "en",
            "title": "Home"
        },
        {
            "id": "en/weekly",
            "title": "Weekly"
        },
        {
            "id": "en/new",
            "title": "New"
        },
        {
            "id": "en/genres",
            "title": "Genre: All"
        },
        {
            "id": "en/genres/Sports",
            "title": "Genre: Sports"
        },
        {
            "id": "en/genres/Historical",
            "title": "Genre: Historical"
        },
        {
            "id": "en/genres/Drama",
            "title": "Genre: Drama"
        },
        {
            "id": "en/genres/BL",
            "title": "Genre: BL"
        },
        {
            "id": "en/genres/Thriller",
            "title": "Genre: Thriller"
        },
        {
            "id": "en/genres/School_life",
            "title": "Genre: School life"
        },
        {
            "id": "en/genres/Comedy",
            "title": "Genre: Comedy"
        },
        {
            "id": "en/genres/GL",
            "title": "Genre: GL"
        },
        {
            "id": "en/genres/Action",
            "title": "Genre: Action"
        },
        {
            "id": "en/genres/Sci-fi",
            "title": "Genre: Sci-fi"
        },
        {
            "id": "en/genres/Horror",
            "title": "Genre: Horror"
        },
        {
            "id": "en/genres/Fantasy",
            "title": "Genre: Fantasy"
        },
        {
            "id": "en/genres/Romance",
            "title": "Genre: Romance"
        }
    ],
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
