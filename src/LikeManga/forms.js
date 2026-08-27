import { AdvancedSearchForm, SelectRow, Section, } from "@paperback/types";
// LikeManga `f[sortby]` query options
export const SORT_OPTIONS = [
    { id: "lastest-chap", title: "Latest Chapter" },
    { id: "lastest-manga", title: "Latest Manga" },
    { id: "top-manga", title: "Top Manga" },
    { id: "top-month", title: "Top This Month" },
    { id: "top-week", title: "Top This Week" },
    { id: "top-day", title: "Top Today" },
    { id: "follow", title: "Most Followed" },
    { id: "comment", title: "Most Commented" },
    { id: "num-chap", title: "Most Chapters" },
];
// LikeManga `f[status]` query options
export const STATUS_OPTIONS = [
    { id: "Complete", title: "Completed" },
    { id: "In process", title: "Ongoing" },
    { id: "Pause", title: "Paused" },
];
export class LikeMangaSearchForm extends AdvancedSearchForm {
    sortBy;
    status;
    constructor(initialMeta) {
        super();
        this.sortBy = initialMeta?.sortBy ?? [];
        this.status = initialMeta?.status ?? [];
    }
    async updateSortBy(value) {
        this.sortBy = value;
        this.reloadForm();
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                sortBy: this.sortBy,
                status: this.status,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("sort_by", {
                    title: "Sort by",
                    value: this.sortBy,
                    options: SORT_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSortBy"),
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
