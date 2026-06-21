import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface TempleScanSearchMeta extends JSONObject {
  status: string[];
  order: string[];
}

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Completed", title: "Completed" },
  { id: "Canceled", title: "Canceled" },
  { id: "Dropped", title: "Dropped" },
];

export const ORDER_OPTIONS: { id: string; title: string }[] = [
  { id: "updated", title: "Update Chapter" },
  { id: "created", title: "Created At" },
  { id: "views", title: "Trending" },
];

export class TempleScanSearchForm extends AdvancedSearchForm {
  private status: string[];
  private order: string[];

  constructor(initialMeta?: TempleScanSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.order = initialMeta?.order ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateOrder(value: string[]): Promise<void> {
    this.order = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        status: this.status,
        order: this.order,
      } satisfies TempleScanSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as TempleScanSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("order", {
          title: "Order by",
          value: this.order,
          options: ORDER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as TempleScanSearchForm,
            "updateOrder",
          ),
        }),
      ]),
    ];
  }
}
