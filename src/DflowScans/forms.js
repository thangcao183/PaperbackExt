import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Completed", title: "Completed" },
    { id: "Hiatus", title: "Hiatus" },
];
export class DflowScansSearchForm extends AdvancedSearchForm {
    status;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                status: this.status,
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
            ]),
        ];
    }
}
