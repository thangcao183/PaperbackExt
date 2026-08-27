import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "publishing", title: "Publishing" },
    { id: "finished", title: "Finished" },
    { id: "on hiatus", title: "On Hiatus" },
    { id: "discontinued", title: "Discontinued" },
    { id: "not yet published", title: "Not yet Published" },
];
export const TYPE_OPTIONS = [
    { id: "", title: "All" },
    { id: "manga", title: "Manga" },
    { id: "novel", title: "Novel" },
    { id: "one-shot", title: "One-Shot" },
    { id: "doujinshi", title: "Doujinshi" },
    { id: "manhwa", title: "Manhwa" },
    { id: "manhua", title: "Manhua" },
    { id: "oel", title: "Oel" },
];
export const GENRE_OPTIONS = [
    "Action",
    "Adventure",
    "Cars",
    "Comedy",
    "Dementia",
    "Demons",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Game",
    "Harem",
    "Hentai",
    "Historical",
    "Horror",
    "Josei",
    "Kids",
    "Magic",
    "Martial Arts",
    "Mecha",
    "Military",
    "Music",
    "Mystery",
    "Parody",
    "Police",
    "Psychological",
    "Romance",
    "Samurai",
    "School",
    "Sci-Fi",
    "Seinen",
    "Shoujo",
    "Shoujo Ai",
    "Shounen",
    "Shounen Ai",
    "Slice of Life",
    "Space",
    "Sports",
    "Super Power",
    "Supernatural",
    "Thriller",
    "Vampire",
    "Yaoi",
    "Yuri",
].map((g) => ({ id: g, title: g }));
export class MangaPillSearchForm extends AdvancedSearchForm {
    status;
    type;
    genres;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
        this.type = initialMeta?.type ?? [];
        this.genres = initialMeta?.genres ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateType(value) {
        this.type = value;
        this.reloadForm();
    }
    async updateGenres(value) {
        this.genres = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                status: this.status,
                type: this.type,
                genres: this.genres,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("status", {
                    title: "Status",
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateStatus"),
                }),
                SelectRow("type", {
                    title: "Type",
                    value: this.type,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateType"),
                }),
                SelectRow("genres", {
                    title: "Genres",
                    value: this.genres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateGenres"),
                }),
            ]),
        ];
    }
}
