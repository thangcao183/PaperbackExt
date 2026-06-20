import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MadThemeSearchMeta extends JSONObject {
  status: string[];
  orderBy: string[];
}

// MadTheme `status` query options (value -> label)
export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "on-hold", title: "On Hold" },
  { id: "canceled", title: "Canceled" },
];

// MadTheme `sort` query options
export const ORDER_BY_OPTIONS = [
  { id: "views", title: "Most Views" },
  { id: "updated_at", title: "Latest Update" },
  { id: "created_at", title: "Newest" },
  { id: "name", title: "A-Z" },
  { id: "rating", title: "Rating" },
];

export class MadThemeSearchForm extends AdvancedSearchForm {
  private status: string[];
  private orderBy: string[];

  constructor(initialMeta?: MadThemeSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.orderBy = initialMeta?.orderBy ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateOrderBy(value: string[]): Promise<void> {
    this.orderBy = value;
    this.reloadForm();
  }

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        status: this.status,
        orderBy: this.orderBy,
      } satisfies MadThemeSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("select_filters", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MadThemeSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateStatus"),
        }),
        SelectRow("order_by", {
          title: "Order by",
          value: this.orderBy,
          options: ORDER_BY_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MadThemeSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderBy"),
        }),
      ]),
    ];
  }
}
