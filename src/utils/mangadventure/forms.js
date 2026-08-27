import { AdvancedSearchForm, InputRow, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "any", title: "Any" },
    { id: "completed", title: "Completed" },
    { id: "ongoing", title: "Ongoing" },
    { id: "hiatus", title: "Hiatus" },
    { id: "canceled", title: "Cancelled" },
];
export const ORDER_BY_OPTIONS = [
    { id: "-views", title: "Most Views" },
    { id: "-latest_upload", title: "Latest Upload" },
    { id: "title", title: "Title (A-Z)" },
    { id: "-title", title: "Title (Z-A)" },
    { id: "-chapter_count", title: "Chapter Count" },
];
export class MangAdventureSearchForm extends AdvancedSearchForm {
    author;
    artist;
    status;
    orderBy;
    constructor(initialMeta) {
        super();
        this.author = initialMeta?.author ?? "";
        this.artist = initialMeta?.artist ?? "";
        this.status = initialMeta?.status ?? [];
        this.orderBy = initialMeta?.orderBy ?? [];
    }
    async updateAuthor(value) {
        this.author = value;
        this.reloadForm();
    }
    async updateArtist(value) {
        this.artist = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
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
                artist: this.artist,
                status: this.status,
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
                InputRow("artist", {
                    title: "Artist",
                    value: this.artist,
                    onValueChange: Application.Selector(this, "updateArtist"),
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
                SelectRow("order_by", {
                    title: "Sort By",
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
