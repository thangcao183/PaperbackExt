import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangAdventureSearchMeta extends JSONObject {
  author: string;
  artist: string;
  status: string[];
  orderBy: string[];
}

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "any", title: "Any" },
  { id: "completed", title: "Completed" },
  { id: "ongoing", title: "Ongoing" },
  { id: "hiatus", title: "Hiatus" },
  { id: "canceled", title: "Cancelled" },
];

export const ORDER_BY_OPTIONS: { id: string; title: string }[] = [
  { id: "-views", title: "Most Views" },
  { id: "-latest_upload", title: "Latest Upload" },
  { id: "title", title: "Title (A-Z)" },
  { id: "-title", title: "Title (Z-A)" },
  { id: "-chapter_count", title: "Chapter Count" },
];

export class MangAdventureSearchForm extends AdvancedSearchForm {
  private author: string;
  private artist: string;
  private status: string[];
  private orderBy: string[];

  constructor(initialMeta?: MangAdventureSearchMeta) {
    super();
    this.author = initialMeta?.author ?? "";
    this.artist = initialMeta?.artist ?? "";
    this.status = initialMeta?.status ?? [];
    this.orderBy = initialMeta?.orderBy ?? [];
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
    this.reloadForm();
  }

  async updateArtist(value: string): Promise<void> {
    this.artist = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateOrderBy(value: string[]): Promise<void> {
    this.orderBy = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        author: this.author,
        artist: this.artist,
        status: this.status,
        orderBy: this.orderBy,
      } satisfies MangAdventureSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("text_filters", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector<
            MangAdventureSearchForm,
            (value: string) => Promise<void>
          >(this, "updateAuthor"),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector<
            MangAdventureSearchForm,
            (value: string) => Promise<void>
          >(this, "updateArtist"),
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
            MangAdventureSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateStatus"),
        }),
        SelectRow("order_by", {
          title: "Sort By",
          value: this.orderBy,
          options: ORDER_BY_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangAdventureSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateOrderBy"),
        }),
      ]),
    ];
  }
}
