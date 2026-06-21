import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaCloudSearchMeta extends JSONObject {
  type: string[];
  status: string[];
  sort: string[];
}

export const TYPE_OPTIONS = [
  { id: "", title: "Any" },
  { id: "Manga", title: "Manga" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manhwa", title: "Manhwa" },
];

export const STATUS_OPTIONS = [
  { id: "", title: "Any" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Cancelled", title: "Cancelled" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Unknown", title: "Unknown" },
];

export const SORT_OPTIONS = [
  { id: "", title: "None" },
  { id: "chapter_date-DESC", title: "Latest Chapter" },
  { id: "chapter_date-ASC", title: "Oldest Chapter" },
  { id: "title-ASC", title: "Title Ascending" },
  { id: "title-DESC", title: "Title Descending" },
  { id: "created_date-DESC", title: "Recently Added" },
  { id: "created_date-ASC", title: "Oldest Added" },
];

export class MangaCloudSearchForm extends AdvancedSearchForm {
  private type: string[];
  private status: string[];
  private sort: string[];

  constructor(initialMeta?: MangaCloudSearchMeta) {
    super();
    this.type = initialMeta?.type ?? [];
    this.status = initialMeta?.status ?? [];
    this.sort = initialMeta?.sort ?? [];
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        type: this.type,
        status: this.status,
        sort: this.sort,
      } satisfies MangaCloudSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaCloudSearchForm,
            "updateType",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaCloudSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("sort", {
          title: "Sort",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaCloudSearchForm,
            "updateSort",
          ),
        }),
      ]),
    ];
  }
}
