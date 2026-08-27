import { AdvancedSearchForm, InputRow, Section, SelectRow, } from "@paperback/types";
// keiyoushi SortFilter (id = query value, default "latest")
export const SORT_OPTIONS = [
    { id: "recently_added", title: "New" },
    { id: "latest", title: "Updated" },
    { id: "popular_daily", title: "Popular (Daily)" },
    { id: "popular_weekly", title: "Popular (Weekly)" },
    { id: "popular_monthly", title: "Popular (Monthly)" },
    { id: "popular_all_time", title: "Popular (All Time)" },
    { id: "rating", title: "Rating" },
    { id: "az", title: "Title (A-Z)" },
    { id: "za", title: "Title (Z-A)" },
];
// keiyoushi StatusFilter ("Any" maps to empty string)
export const STATUS_OPTIONS = [
    { id: "", title: "Any" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Hiatus" },
];
// keiyoushi TypeFilter ("Any" maps to empty string)
export const TYPE_OPTIONS = [
    { id: "", title: "Any" },
    { id: "Manga", title: "Manga" },
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
    { id: "Webtoon", title: "Webtoon" },
];
// keiyoushi GenreFilter (id = genre name used in include/exclude_genres csv)
export const GENRE_OPTIONS = [
    "Action",
    "Adventure",
    "Comedy",
    "Cooking",
    "Manga",
    "Drama",
    "Fantasy",
    "Gender bender",
    "Harem",
    "Historical",
    "Horror",
    "Isekai",
    "Josei",
    "Manhua",
    "Manhwa",
    "Martial arts",
    "Mature",
    "Mecha",
    "Medical",
    "Mystery",
    "One shot",
    "Psychological",
    "Romance",
    "School life",
    "Sci fi",
    "Seinen",
    "Shoujo",
    "Shounen",
    "Slice of life",
    "Sports",
    "Supernatural",
    "Tragedy",
    "Webtoons",
    "Ladies",
].map((g) => ({ id: g, title: g }));
// keiyoushi ExtraFilter (id = query param toggled to "1")
export const EXTRA_OPTIONS = [
    { id: "only_completed", title: "Only completed series" },
    { id: "only_translated", title: "At least 50+ chapters translated" },
    { id: "hide_on_break", title: "Hide long hiatus (> 6 months)" },
];
export class MangaGekoSearchForm extends AdvancedSearchForm {
    sort;
    status;
    type;
    includeGenres;
    excludeGenres;
    extras;
    tags;
    minChapters;
    maxChapters;
    minRating;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
        this.status = initialMeta?.status ?? [];
        this.type = initialMeta?.type ?? [];
        this.includeGenres = initialMeta?.includeGenres ?? [];
        this.excludeGenres = initialMeta?.excludeGenres ?? [];
        this.extras = initialMeta?.extras ?? [];
        this.tags = initialMeta?.tags ?? "";
        this.minChapters = initialMeta?.minChapters ?? "";
        this.maxChapters = initialMeta?.maxChapters ?? "";
        this.minRating = initialMeta?.minRating ?? "";
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateType(value) {
        this.type = value;
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
    async updateExtras(value) {
        this.extras = value;
        this.reloadForm();
    }
    async updateTags(value) {
        this.tags = value;
        this.reloadForm();
    }
    async updateMinChapters(value) {
        this.minChapters = value;
        this.reloadForm();
    }
    async updateMaxChapters(value) {
        this.maxChapters = value;
        this.reloadForm();
    }
    async updateMinRating(value) {
        this.minRating = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            sort: this.sort,
            status: this.status,
            type: this.type,
            includeGenres: this.includeGenres,
            excludeGenres: this.excludeGenres,
            extras: this.extras,
            tags: this.tags,
            minChapters: this.minChapters,
            maxChapters: this.maxChapters,
            minRating: this.minRating,
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("sort", {
                    title: "Sort",
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSort"),
                }),
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
                SelectRow("extras", {
                    title: "Extras",
                    value: this.extras,
                    options: EXTRA_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: EXTRA_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateExtras"),
                }),
                InputRow("tags", {
                    title: "Tags (comma separated)",
                    value: this.tags,
                    onValueChange: Application.Selector(this, "updateTags"),
                }),
                InputRow("min_chapters", {
                    title: "Minimum Chapter",
                    value: this.minChapters,
                    onValueChange: Application.Selector(this, "updateMinChapters"),
                }),
                InputRow("max_chapters", {
                    title: "Maximum Chapter",
                    value: this.maxChapters,
                    onValueChange: Application.Selector(this, "updateMaxChapters"),
                }),
                InputRow("min_rating", {
                    title: "Minimum Rating (e.g. 1.1, 5.0)",
                    value: this.minRating,
                    onValueChange: Application.Selector(this, "updateMinRating"),
                }),
            ]),
        ];
    }
}
