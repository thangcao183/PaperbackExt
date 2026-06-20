import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface HeanCmsSearchMeta extends JSONObject {
  status: string[];
  orderBy: string[];
  orderDirection: string[];
}

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
  private status: string[];
  private orderBy: string[];
  private orderDirection: string[];

  constructor(initialMeta?: HeanCmsSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.orderBy = initialMeta?.orderBy ?? [];
    this.orderDirection = initialMeta?.orderDirection ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateOrderBy(value: string[]): Promise<void> {
    this.orderBy = value;
    this.reloadForm();
  }

  async updateOrderDirection(value: string[]): Promise<void> {
    this.orderDirection = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        status: this.status,
        orderBy: this.orderBy,
        orderDirection: this.orderDirection,
      } satisfies HeanCmsSearchMeta,
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
          onValueChange: Application.Selector<
            HeanCmsSearchForm,
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
            HeanCmsSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderBy"),
        }),
        SelectRow("order_direction", {
          title: "Order direction",
          value: this.orderDirection,
          options: ORDER_DIRECTION_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            HeanCmsSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderDirection"),
        }),
      ]),
    ];
  }
}
