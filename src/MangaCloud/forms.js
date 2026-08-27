import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const TYPE_OPTIONS = [
    { id: "", title: "Any" },
    { id: "Manga", title: "Manga" },
    { id: "Manhua", title: "Manhua" },
    { id: "Manhwa", title: "Manhwa" },
];
export const STATUS_OPTIONS = [
    { id: "", title: "Any" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Cancelled", title: "Cancelled" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Unknown", title: "Unknown" },
];
export const SORT_OPTIONS = [
    { id: "", title: "None" },
    { id: "chapter_date-DESC", title: "Latest Chapter" },
    { id: "chapter_date-ASC", title: "Oldest Chapter" },
    { id: "title-ASC", title: "Title Ascending" },
    { id: "title-DESC", title: "Title Descending" },
    { id: "created_date-DESC", title: "Recently Added" },
    { id: "created_date-ASC", title: "Oldest Added" },
];
export class MangaCloudSearchForm extends AdvancedSearchForm {
    type;
    status;
    sort;
    constructor(initialMeta) {
        super();
        this.type = initialMeta?.type ?? [];
        this.status = initialMeta?.status ?? [];
        this.sort = initialMeta?.sort ?? [];
    }
    async updateType(value) {
        this.type = value;
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
                type: this.type,
                status: this.status,
                sort: this.sort,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("type", {
                    title: "Type",
                    value: this.type,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateType"),
                }),
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
            ]),
        ];
    }
}
