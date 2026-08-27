import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
// Upstream builds browse URLs out of path segments, so each option's id is the
// already-slugified form of its title (see `toPathSegment` in main.ts).
export const GENRE_OPTIONS = [
    { id: "all", title: "All" },
    { id: "romance", title: "Romance" },
    { id: "action", title: "Action" },
    { id: "fantasy", title: "Fantasy" },
    { id: "bl", title: "BL" },
    { id: "eastern-fantasy", title: "Eastern Fantasy" },
    { id: "eastern-romance", title: "Eastern Romance" },
    { id: "drama", title: "Drama" },
    { id: "gl", title: "GL" },
    { id: "lgbtq", title: "LGBTQ+" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "comedy", title: "Comedy" },
    { id: "horror", title: "Horror" },
    { id: "mystery", title: "Mystery" },
    { id: "scifi", title: "Sci-Fi" },
];
export const STATUS_OPTIONS = [
    { id: "all", title: "All" },
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
];
export const SORT_OPTIONS = [
    { id: "hottest", title: "Hottest" },
    { id: "bestrated", title: "Best-rated" },
    { id: "newest", title: "Newest" },
];
export class WebcomicsSearchForm extends AdvancedSearchForm {
    genre;
    status;
    sort;
    constructor(initialMeta) {
        super();
        this.genre = initialMeta?.genre ?? [];
        this.status = initialMeta?.status ?? [];
        this.sort = initialMeta?.sort ?? [];
    }
    async updateGenre(value) {
        this.genre = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                genre: this.genre,
                status: this.status,
                sort: this.sort,
            },
        };
    }
    getSections() {
        return [
            Section({
                id: "filters",
                footer: "Filtering is ignored when searching by text.",
            }, [
                SelectRow("genre", {
                    title: "Genres",
                    value: this.genre,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateGenre"),
                }),
                SelectRow("status", {
                    title: "Filter By",
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateStatus"),
                }),
                SelectRow("sort", {
                    title: "Sort By",
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSort"),
                }),
            ]),
        ];
    }
}
