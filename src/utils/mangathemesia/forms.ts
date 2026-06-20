import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaThemesiaSearchMeta extends JSONObject {
  author: string;
  year: string;
  status: string[];
  type: string[];
  orderBy: string[];
}

// MangaThemesia `status` query options (value -> label)
export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "dropped", title: "Dropped" },
];

// MangaThemesia `type` query options
export const TYPE_OPTIONS = [
  { id: "", title: "All" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Comic", title: "Comic" },
];

// MangaThemesia `order` query options
export const ORDER_BY_OPTIONS = [
  { id: "", title: "Default" },
  { id: "title", title: "A-Z" },
  { id: "titlereverse", title: "Z-A" },
  { id: "update", title: "Latest Update" },
  { id: "latest", title: "Latest Added" },
  { id: "popular", title: "Popular" },
];

export class MangaThemesiaSearchForm extends AdvancedSearchForm {
  private author: string;
  private year: string;
  private status: string[];
  private type: string[];
  private orderBy: string[];

  constructor(initialMeta?: MangaThemesiaSearchMeta) {
    super();
    this.author = initialMeta?.author ?? "";
    this.year = initialMeta?.year ?? "";
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.orderBy = initialMeta?.orderBy ?? [];
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
    this.reloadForm();
  }

  async updateYear(value: string): Promise<void> {
    this.year = value;
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

  async updateOrderBy(value: string[]): Promise<void> {
    this.orderBy = value;
    this.reloadForm();
  }

  getSearchQueryMetadata() {
    return {
      searchMeta: {
        author: this.author,
        year: this.year,
        status: this.status,
        type: this.type,
        orderBy: this.orderBy,
      } satisfies MangaThemesiaSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("text_filters", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector<
            MangaThemesiaSearchForm,
            (value: string) => Promise<void>
          >(this, "updateAuthor"),
        }),
        InputRow("year", {
          title: "Year of release",
          value: this.year,
          onValueChange: Application.Selector<
            MangaThemesiaSearchForm,
            (value: string) => Promise<void>
          >(this, "updateYear"),
        }),
      ]),
      Section("select_filters", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaThemesiaSearchForm,
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
            MangaThemesiaSearchForm,
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
            MangaThemesiaSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderBy"),
        }),
      ]),
    ];
  }
}
