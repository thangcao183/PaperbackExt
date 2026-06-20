import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface EZManhwaSearchMeta extends JSONObject {
  sort: string[];
  status: string[];
  type: string[];
}

// EZManhwa `sort` query options (value -> label)
export const SORT_OPTIONS = [
  { id: "latest", title: "Latest" },
  { id: "popular", title: "Popular" },
  { id: "newest", title: "Newest" },
  { id: "alphabetical", title: "Alphabetical" },
];

// EZManhwa `status` query options
export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "DROPPED", title: "Dropped" },
];

// EZManhwa `type` query options
export const TYPE_OPTIONS = [
  { id: "", title: "All" },
  { id: "MANGA", title: "Manga" },
  { id: "MANHWA", title: "Manhwa" },
  { id: "MANHUA", title: "Manhua" },
];

export class EZManhwaSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private status: string[];
  private type: string[];

  constructor(initialMeta?: EZManhwaSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        sort: this.sort,
        status: this.status,
        type: this.type,
      } satisfies EZManhwaSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("select_filters", [
        SelectRow("sort", {
          title: "Sort by",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            EZManhwaSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateSort"),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            EZManhwaSearchForm,
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
            EZManhwaSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateType"),
        }),
      ]),
    ];
  }
}
