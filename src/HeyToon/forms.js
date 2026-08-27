import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
const SORT_OPTIONS = [
    { id: "latest", title: "Most Recent" },
    { id: "views", title: "Most Viewed" },
];
const GENRE_OPTIONS = [
    { id: "", title: "All" },
    { id: "Detective", title: "Detective" },
    { id: "Spin-Off", title: "Spin-Off" },
    { id: "Mommy", title: "Mommy" },
    { id: "Uncensored", title: "Uncensored" },
    { id: "New", title: "New" },
    { id: "In-Law", title: "In-Law" },
    { id: "Cheating", title: "Cheating" },
    { id: "MILF", title: "MILF" },
    { id: "Harem", title: "Harem" },
    { id: "College", title: "College" },
    { id: "Business", title: "Business" },
    { id: "Supernatural", title: "Supernatural" },
    { id: "Thriller", title: "Thriller" },
    { id: "Adventure", title: "Adventure" },
    { id: "Romance", title: "Romance" },
    { id: "Drama", title: "Drama" },
];
export class HeyToonSearchForm extends AdvancedSearchForm {
    sort;
    genre;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
        this.genre = initialMeta?.genre ?? [];
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateGenre(value) {
        this.genre = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                sort: this.sort,
                genre: this.genre,
            },
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
                SelectRow("genre", {
                    title: "Genre",
                    value: this.genre,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateGenre"),
                }),
            ]),
        ];
    }
}
