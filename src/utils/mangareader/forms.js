import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const SORT_OPTIONS = [
    { id: "default", title: "Default" },
    { id: "latest-updated", title: "Latest Updated" },
    { id: "score", title: "Score" },
    { id: "name-az", title: "Name A-Z" },
    { id: "release-date", title: "Release Date" },
    { id: "most-viewed", title: "Most Viewed" },
];
export class MangaReaderSearchForm extends AdvancedSearchForm {
    sort;
    constructor(initialMeta) {
        super();
        this.sort = initialMeta?.sort ?? [];
    }
    async updateSort(value) {
        this.sort = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            sort: this.sort,
        };
    }
    getSections() {
        return [
            Section("select_filters", [
                SelectRow("sort", {
                    title: "Sort",
                    value: this.sort,
                    options: SORT_OPTIONS.map((o) => ({ id: o.id, title: o.title })),
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateSort"),
                }),
            ]),
        ];
    }
}
