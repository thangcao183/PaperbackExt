import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface IkenSearchMeta extends JSONObject {
  status: string[];
  type: string[];
  orderBy: string[];
  orderDirection: string[];
}

// Iken `seriesStatus` query options (value -> label)
export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "CANCELLED", title: "Canceled" },
  { id: "DROPPED", title: "Dropped" },
  { id: "COMING_SOON", title: "Coming Soon" },
  { id: "MASS_RELEASED", title: "Mass Released" },
];

// Iken `seriesType` query options
export const TYPE_OPTIONS = [
  { id: "", title: "All" },
  { id: "MANGA", title: "Manga" },
  { id: "MANHUA", title: "Manhua" },
  { id: "MANHWA", title: "Manhwa" },
  { id: "RUSSIAN", title: "Russian" },
  { id: "SPANISH", title: "Spanish" },
];

// Iken `orderBy` query options
export const ORDER_BY_OPTIONS = [
  { id: "lastChapterAddedAt", title: "Last Chapter" },
  { id: "totalViews", title: "Views" },
  { id: "createdAt", title: "Added Date" },
  { id: "chaptersCount", title: "Chapters Count" },
  { id: "postTitle", title: "Alphabetical" },
];

// Iken `orderDirection` query options
export const ORDER_DIRECTION_OPTIONS = [
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export class IkenSearchForm extends AdvancedSearchForm {
  private status: string[];
  private type: string[];
  private orderBy: string[];
  private orderDirection: string[];

  constructor(initialMeta?: IkenSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.orderBy = initialMeta?.orderBy ?? [];
    this.orderDirection = initialMeta?.orderDirection ?? [];
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
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

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        status: this.status,
        type: this.type,
        orderBy: this.orderBy,
        orderDirection: this.orderDirection,
      } satisfies IkenSearchMeta,
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
            IkenSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateStatus"),
        }),
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            IkenSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateType"),
        }),
        SelectRow("order_by", {
          title: "Order by",
          value: this.orderBy,
          options: ORDER_BY_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            IkenSearchForm,
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
            IkenSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderDirection"),
        }),
      ]),
    ];
  }
}
