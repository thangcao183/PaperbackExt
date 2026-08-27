import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const ORDER_BY_OPTIONS = [
    { id: "2", title: "Views" },
    { id: "3", title: "Latest" },
    { id: "1", title: "A-Z" },
];
export class PaprikaSearchForm extends AdvancedSearchForm {
    orderBy;
    constructor(initialMeta) {
        super();
        this.orderBy = initialMeta?.orderBy ?? [];
    }
    async updateOrderBy(value) {
        this.orderBy = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            orderBy: this.orderBy,
        };
    }
    getSections() {
        return [
            Section("select_filters", [
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
