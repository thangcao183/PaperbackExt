import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Completed", title: "Completed" },
    { id: "Canceled", title: "Canceled" },
    { id: "Dropped", title: "Dropped" },
];
export const ORDER_OPTIONS = [
    { id: "updated", title: "Update Chapter" },
    { id: "created", title: "Created At" },
    { id: "views", title: "Trending" },
];
export class TempleScanSearchForm extends AdvancedSearchForm {
    status;
    order;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
        this.order = initialMeta?.order ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateOrder(value) {
        this.order = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                status: this.status,
                order: this.order,
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
                SelectRow("order", {
                    title: "Order by",
                    value: this.order,
                    options: ORDER_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateOrder"),
                }),
            ]),
        ];
    }
}
