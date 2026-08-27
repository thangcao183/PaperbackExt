import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "", title: "Any" },
    { id: "Completed", title: "Completed" },
    { id: "Ongoing", title: "Ongoing" },
];
export const SORT_OPTIONS = [
    { id: "", title: "Alphabet" },
    { id: "MostPopular", title: "Popularity" },
    { id: "LatestUpdate", title: "Latest Update" },
    { id: "Newest", title: "New Comic" },
];
export const YEAR_OPTIONS = (() => {
    const opts = [{ id: "", title: "Any" }];
    for (let y = 2026; y >= 1920; y--) {
        opts.push({ id: String(y), title: String(y) });
    }
    return opts;
})();
// Genre name -> gid mapping (from Readcomiconline Filters).
export const GENRE_OPTIONS = [
    { id: "1", title: "Action" },
    { id: "2", title: "Adventure" },
    { id: "38", title: "Anthology" },
    { id: "46", title: "Anthropomorphic" },
    { id: "41", title: "Biography" },
    { id: "49", title: "Children" },
    { id: "3", title: "Comedy" },
    { id: "17", title: "Crime" },
    { id: "19", title: "Drama" },
    { id: "25", title: "Family" },
    { id: "20", title: "Fantasy" },
    { id: "31", title: "Fighting" },
    { id: "5", title: "Graphic Novels" },
    { id: "28", title: "Historical" },
    { id: "15", title: "Horror" },
    { id: "35", title: "Leading Ladies" },
    { id: "51", title: "LGBTQ" },
    { id: "44", title: "Literature" },
    { id: "40", title: "Manga" },
    { id: "4", title: "Martial Arts" },
    { id: "8", title: "Mature" },
    { id: "33", title: "Military" },
    { id: "56", title: "Mini-Series" },
    { id: "47", title: "Movies & TV" },
    { id: "55", title: "Music" },
    { id: "23", title: "Mystery" },
    { id: "21", title: "Mythology" },
    { id: "48", title: "Personal" },
    { id: "42", title: "Political" },
    { id: "43", title: "Post-Apocalyptic" },
    { id: "27", title: "Psychological" },
    { id: "39", title: "Pulp" },
    { id: "53", title: "Religious" },
    { id: "9", title: "Robots" },
    { id: "32", title: "Romance" },
    { id: "52", title: "School Life" },
    { id: "16", title: "Sci-Fi" },
    { id: "50", title: "Slice of Life" },
    { id: "54", title: "Sport" },
    { id: "30", title: "Spy" },
    { id: "22", title: "Superhero" },
    { id: "24", title: "Supernatural" },
    { id: "29", title: "Suspense" },
    { id: "18", title: "Thriller" },
    { id: "34", title: "Vampires" },
    { id: "37", title: "Video Games" },
    { id: "26", title: "War" },
    { id: "45", title: "Western" },
    { id: "36", title: "Zombies" },
];
export class ReadComicOnlineSearchForm extends AdvancedSearchForm {
    status;
    sort;
    year;
    includeGenres;
    excludeGenres;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
        this.sort = initialMeta?.sort ?? [];
        this.year = initialMeta?.year ?? [];
        this.includeGenres = initialMeta?.includeGenres ?? [];
        this.excludeGenres = initialMeta?.excludeGenres ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateYear(value) {
        this.year = value;
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
                status: this.status,
                sort: this.sort,
                year: this.year,
                includeGenres: this.includeGenres,
                excludeGenres: this.excludeGenres,
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
                SelectRow("sort", {
                    title: "Sort",
                    value: this.sort,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSort"),
                }),
                SelectRow("year", {
                    title: "Year",
                    value: this.year,
                    options: YEAR_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateYear"),
                }),
                SelectRow("include_genres", {
                    title: "Include genres",
                    value: this.includeGenres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateIncludeGenres"),
                }),
                SelectRow("exclude_genres", {
                    title: "Exclude genres",
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
