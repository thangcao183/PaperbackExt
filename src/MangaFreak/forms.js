import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
// Order MUST match the keiyoushi Filters.kt genre list exactly (one digit per genre).
export const GENRE_ORDER = [
    "Act",
    "Adult",
    "Adventure",
    "Ancients",
    "Animated",
    "Comedy",
    "Demons",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Gender Bender",
    "Harem",
    "Horror",
    "Josei",
    "Magic",
    "Martial Arts",
    "Mature",
    "Mecha",
    "Military",
    "Mystery",
    "One Shot",
    "Psychological",
    "Romance",
    "School Life",
    "Sci Fi",
    "Seinen",
    "Shoujo",
    "Shoujoai",
    "Shounen",
    "Shounenai",
    "Slice Of Life",
    "Smut",
    "Sports",
    "Super Power",
    "Supernatural",
    "Tragedy",
    "Vampire",
    "Yaoi",
    "Yuri",
];
const GENRE_OPTIONS = GENRE_ORDER.map((g) => ({ id: g, title: g }));
// keiyoushi TypeFilter: Both=0, Manga=2, Manhwa=1
export const TYPE_OPTIONS = [
    { id: "0", title: "Both" },
    { id: "2", title: "Manga" },
    { id: "1", title: "Manhwa" },
];
// keiyoushi StatusFilter: Both=0, Completed=1, Ongoing=2
export const STATUS_OPTIONS = [
    { id: "0", title: "Both" },
    { id: "1", title: "Completed" },
    { id: "2", title: "Ongoing" },
];
export class MangaFreakSearchForm extends AdvancedSearchForm {
    includeGenres;
    excludeGenres;
    type;
    status;
    constructor(initialMeta) {
        super();
        this.includeGenres = initialMeta?.includeGenres ?? [];
        this.excludeGenres = initialMeta?.excludeGenres ?? [];
        this.type = initialMeta?.type ?? [];
        this.status = initialMeta?.status ?? [];
    }
    async updateIncludeGenres(value) {
        this.includeGenres = value;
        this.reloadForm();
    }
    async updateExcludeGenres(value) {
        this.excludeGenres = value;
        this.reloadForm();
    }
    async updateType(value) {
        this.type = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            includeGenres: this.includeGenres,
            excludeGenres: this.excludeGenres,
            type: this.type,
            status: this.status,
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("include_genres", {
                    title: "Include Genres",
                    value: this.includeGenres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateIncludeGenres"),
                }),
                SelectRow("exclude_genres", {
                    title: "Exclude Genres",
                    value: this.excludeGenres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateExcludeGenres"),
                }),
                SelectRow("type", {
                    title: "Manga Type",
                    value: this.type,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateType"),
                }),
                SelectRow("status", {
                    title: "Manga Status",
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateStatus"),
                }),
            ]),
        ];
    }
}
