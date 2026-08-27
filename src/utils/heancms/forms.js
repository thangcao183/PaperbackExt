import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const STATUS_OPTIONS = [
    { id: "All", title: "All" },
    { id: "Ongoing", title: "Ongoing" },
    { id: "Hiatus", title: "Hiatus" },
    { id: "Dropped", title: "Dropped" },
    { id: "Completed", title: "Completed" },
    { id: "Canceled", title: "Canceled" },
];
export const ORDER_BY_OPTIONS = [
    { id: "total_views", title: "Views" },
    { id: "title", title: "A-Z" },
    { id: "latest", title: "Latest" },
    { id: "created_at", title: "Created" },
];
export const ORDER_DIRECTION_OPTIONS = [
    { id: "desc", title: "Descending" },
    { id: "asc", title: "Ascending" },
];
export class HeanCmsSearchForm extends AdvancedSearchForm {
    status;
    orderBy;
    orderDirection;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
        this.orderBy = initialMeta?.orderBy ?? [];
        this.orderDirection = initialMeta?.orderDirection ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateOrderBy(value) {
        this.orderBy = value;
        this.reloadForm();
    }
    async updateOrderDirection(value) {
        this.orderDirection = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                status: this.status,
                orderBy: this.orderBy,
                orderDirection: this.orderDirection,
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
                SelectRow("order_by", {
                    title: "Order by",
                    value: this.orderBy,
                    options: ORDER_BY_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateOrderBy"),
                }),
                SelectRow("order_direction", {
                    title: "Order direction",
                    value: this.orderDirection,
                    options: ORDER_DIRECTION_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateOrderDirection"),
                }),
            ]),
        ];
    }
}
