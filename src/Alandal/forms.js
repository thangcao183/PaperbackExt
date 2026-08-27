import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
const GENRE_OPTIONS = [
    { id: "1", title: "Action" },
    { id: "2", title: "Fantasy" },
    { id: "3", title: "Regression" },
    { id: "4", title: "Overpowered" },
    { id: "5", title: "Ascension" },
    { id: "6", title: "Revenge" },
    { id: "7", title: "Martial Arts" },
    { id: "8", title: "Magic" },
    { id: "9", title: "Necromancer" },
    { id: "10", title: "Adventure" },
    { id: "11", title: "Tower" },
    { id: "12", title: "Dungeons" },
    { id: "13", title: "Psychological" },
    { id: "14", title: "Isekai" },
];
const SORT_OPTIONS = [
    { id: "popular", title: "Popularity" },
    { id: "name", title: "Name" },
    { id: "chapters", title: "Chapters" },
    { id: "Rating", title: "Rating" },
    { id: "new", title: "New" },
];
const STATUS_OPTIONS = [
    { id: "-1", title: "Any" },
    { id: "1", title: "Ongoing" },
    { id: "5", title: "Coming Soon" },
    { id: "6", title: "Completed" },
];
export class AlandalSearchForm extends AdvancedSearchForm {
    genres;
    sort;
    status;
    constructor(initialMeta) {
        super();
        this.genres = initialMeta?.genres ?? [];
        this.sort = initialMeta?.sort ?? [];
        this.status = initialMeta?.status ?? [];
    }
    async updateGenres(value) {
        this.genres = value;
        this.reloadForm();
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                genres: this.genres,
                sort: this.sort,
                status: this.status,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("genres", {
                    title: "Genre",
                    value: this.genres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateGenres"),
                }),
                SelectRow("sort", {
                    title: "Sort By",
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
            ]),
        ];
    }
}
