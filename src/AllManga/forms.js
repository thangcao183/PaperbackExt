import { AdvancedSearchForm, Section, SelectRow } from "@paperback/types";
export const SORT_OPTIONS = [
    { id: "", title: "Update" },
    { id: "Name_ASC", title: "Name Ascending" },
    { id: "Name_DESC", title: "Name Descending" },
];
export const COUNTRY_OPTIONS = [
    { id: "ALL", title: "All" },
    { id: "JP", title: "Japan" },
    { id: "CN", title: "China" },
    { id: "KR", title: "Korea" },
];
const GENRE_NAMES = [
    "4 Koma", "Action", "Adult", "Adventure", "Cars", "Comedy", "Cooking",
    "Crossdressing", "Dementia", "Demons", "Doujinshi", "Drama", "Ecchi",
    "Fantasy", "Game", "Gender Bender", "Gyaru", "Harem", "Historical", "Horror",
    "Isekai", "Josei", "Kids", "Loli", "Magic", "Manhua", "Manhwa",
    "Martial Arts", "Mature", "Mecha", "Medical", "Military", "Monster Girls",
    "Music", "Mystery", "One Shot", "Parody", "Police", "Post Apocalyptic",
    "Psychological", "Reincarnation", "Reverse Harem", "Romance", "Samurai",
    "School", "Sci-Fi", "Seinen", "Shota", "Shoujo", "Shoujo Ai", "Shounen",
    "Shounen Ai", "Slice of Life", "Smut", "Space", "Sports", "Super Power",
    "Supernatural", "Suspense", "Thriller", "Tragedy", "Unknown", "Vampire",
    "Webtoons", "Yaoi", "Youkai", "Yuri", "Zombies",
];
export const GENRE_OPTIONS = GENRE_NAMES.map((name) => ({ id: name, title: name }));
export class AllMangaSearchForm extends AdvancedSearchForm {
    sort;
    country;
    includeGenres;
    excludeGenres;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
        this.country = initialMeta?.country ?? [];
        this.includeGenres = initialMeta?.includeGenres ?? [];
        this.excludeGenres = initialMeta?.excludeGenres ?? [];
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateCountry(value) {
        this.country = value;
        this.reloadForm();
    }
    async updateIncludeGenres(value) {
        this.includeGenres = value;
        this.reloadForm();
    }
    async updateExcludeGenres(value) {
        this.excludeGenres = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                sort: this.sort,
                country: this.country,
                includeGenres: this.includeGenres,
                excludeGenres: this.excludeGenres,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("sort", {
                    title: "Sort By",
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSort"),
                }),
                SelectRow("country", {
                    title: "Country of Origin",
                    value: this.country,
                    options: COUNTRY_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateCountry"),
                }),
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
            ]),
        ];
    }
}
