import { AdvancedSearchForm, Section, SelectRow, InputRow, } from "@paperback/types";
export const SORT_OPTIONS = [
    { id: "", title: "Default" },
    { id: "date", title: "Date" },
    { id: "editdate", title: "Date of change" },
    { id: "rating", title: "Rating" },
    { id: "news_read", title: "Read" },
    { id: "comm_num", title: "Comments" },
    { id: "title", title: "Title" },
];
export const DIRECTION_OPTIONS = [
    { id: "desc", title: "Descending" },
    { id: "asc", title: "Ascending" },
];
export class BatCaveSearchForm extends AdvancedSearchForm {
    sort;
    direction;
    yearFrom;
    yearTo;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
        this.direction = initialMeta?.direction ?? [];
        this.yearFrom = initialMeta?.yearFrom ?? "";
        this.yearTo = initialMeta?.yearTo ?? "";
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    async updateDirection(value) {
        this.direction = value;
        this.reloadForm();
    }
    async updateYearFrom(value) {
        this.yearFrom = value;
        this.reloadForm();
    }
    async updateYearTo(value) {
        this.yearTo = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                sort: this.sort,
                direction: this.direction,
                yearFrom: this.yearFrom,
                yearTo: this.yearTo,
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
                SelectRow("direction", {
                    title: "Direction",
                    value: this.direction,
                    options: DIRECTION_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateDirection"),
                }),
                InputRow("year_from", {
                    title: "Year from",
                    value: this.yearFrom,
                    onValueChange: Application.Selector(this, "updateYearFrom"),
                }),
                InputRow("year_to", {
                    title: "Year to",
                    value: this.yearTo,
                    onValueChange: Application.Selector(this, "updateYearTo"),
                }),
            ]),
        ];
    }
}
