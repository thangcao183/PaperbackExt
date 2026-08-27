import { AdvancedSearchForm, InputRow, Section, SelectRow, } from "@paperback/types";
// MangaThemesia `status` query options (value -> label)
export const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
    { id: "dropped", title: "Dropped" },
];
// MangaThemesia `type` query options
export const TYPE_OPTIONS = [
    { id: "", title: "All" },
    { id: "Manga", title: "Manga" },
    { id: "Manhwa", title: "Manhwa" },
    { id: "Manhua", title: "Manhua" },
    { id: "Comic", title: "Comic" },
];
// MangaThemesia `order` query options
export const ORDER_BY_OPTIONS = [
    { id: "", title: "Default" },
    { id: "title", title: "A-Z" },
    { id: "titlereverse", title: "Z-A" },
    { id: "update", title: "Latest Update" },
    { id: "latest", title: "Latest Added" },
    { id: "popular", title: "Popular" },
];
export class MangaThemesiaSearchForm extends AdvancedSearchForm {
    author;
    year;
    status;
    type;
    orderBy;
    constructor(initialMeta) {
        super();
        this.author = initialMeta?.author ?? "";
        this.year = initialMeta?.year ?? "";
        this.status = initialMeta?.status ?? [];
        this.type = initialMeta?.type ?? [];
        this.orderBy = initialMeta?.orderBy ?? [];
    }
    async updateAuthor(value) {
        this.author = value;
        this.reloadForm();
    }
    async updateYear(value) {
        this.year = value;
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
    async updateOrderBy(value) {
        this.orderBy = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                author: this.author,
                year: this.year,
                status: this.status,
                type: this.type,
                orderBy: this.orderBy,
            },
        };
    }
    getSections() {
        return [
            Section("text_filters", [
                InputRow("author", {
                    title: "Author",
                    value: this.author,
                    onValueChange: Application.Selector(this, "updateAuthor"),
                }),
                InputRow("year", {
                    title: "Year of release",
                    value: this.year,
                    onValueChange: Application.Selector(this, "updateYear"),
                }),
            ]),
            Section("select_filters", [
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
                SelectRow("order_by", {
                    title: "Order by",
                    value: this.orderBy,
                    options: ORDER_BY_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateOrderBy"),
                }),
            ]),
        ];
    }
}
