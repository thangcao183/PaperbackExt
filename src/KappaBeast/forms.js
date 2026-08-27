import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
const GENRE_OPTIONS = [
    { id: "", title: "All" },
    { id: "Fantasy", title: "Fantasy" },
    { id: "Romance", title: "Romance" },
    { id: "Comedy", title: "Comedy" },
    { id: "Drama", title: "Drama" },
    { id: "Thriller", title: "Thriller" },
    { id: "Action", title: "Action" },
    { id: "Psychological", title: "Psychological" },
    { id: "Isekai", title: "Isekai" },
];
const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Hiatus" },
];
const TYPE_OPTIONS = [
    { id: "", title: "All" },
    { id: "Manga", title: "Manga" },
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
];
const SORT_OPTIONS = [
    { id: "", title: "Popularity" },
    { id: "updatedAt:desc", title: "Latest Updates" },
    { id: "createdAt:desc", title: "Newest" },
    { id: "title:asc", title: "A-Z Name" },
];
export class KappaBeastSearchForm extends AdvancedSearchForm {
    genre;
    status;
    type;
    sort;
    constructor(initialMeta) {
        super();
        this.genre = initialMeta?.genre ?? [];
        this.status = initialMeta?.status ?? [];
        this.type = initialMeta?.type ?? [];
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
    async updateType(value) {
        this.type = value;
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
                type: this.type,
                sort: this.sort,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("genre", {
                    title: "Genre",
                    value: this.genre,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateGenre"),
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
