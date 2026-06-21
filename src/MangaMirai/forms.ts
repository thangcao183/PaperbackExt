import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaMiraiSearchMeta extends JSONObject {
  order: string[];
  genre: string[];
  publisher: string[];
  tags: string[];
}

export const ORDER_OPTIONS: { id: string; title: string }[] = [
  { id: "new", title: "Newest" },
  { id: "ranking", title: "Ranking" },
];

export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Action", title: "Action" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Romance", title: "Romance" },
  { id: "Drama", title: "Drama" },
  { id: "Horror", title: "Horror" },
  { id: "Suspense", title: "Suspense" },
  { id: "Mystery", title: "Mystery" },
  { id: "Sports", title: "Sports" },
  { id: "Slice of Life", title: "Slice of Life" },
  { id: "Boys Love", title: "Boys Love" },
  { id: "Girls Love", title: "Girls Love" },
  { id: "Sci-Fi", title: "Sci-Fi" },
  { id: "Gourmet", title: "Gourmet" },
  { id: "Historical", title: "Historical" },
  { id: "Comedy", title: "Comedy" },
  { id: "Other", title: "Other" },
];

export const TAG_OPTIONS: { id: string; title: string }[] = [
  { id: "Free", title: "Free" },
  { id: "On Sale", title: "On Sale" },
  { id: "New", title: "New" },
  { id: "Completed", title: "Completed" },
  { id: "Manga", title: "Manga" },
  { id: "V-scroll Manga", title: "V-scroll Manga" },
  { id: "Chapter", title: "Chapter" },
];

export const PUBLISHER_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Yen Press", title: "Yen Press" },
  { id: "Kodansha USA Publishing LLC", title: "Kodansha USA Publishing LLC" },
  { id: "VIZ Media LLC", title: "VIZ Media LLC" },
  { id: "Manga UP!", title: "Manga UP!" },
  { id: "Seven Seas Entertainment", title: "Seven Seas Entertainment" },
  { id: "Square Enix", title: "Square Enix" },
  { id: "J-Novel Club", title: "J-Novel Club" },
  { id: "TOKYOPOP", title: "TOKYOPOP" },
];

export class MangaMiraiSearchForm extends AdvancedSearchForm {
  private order: string[];
  private genre: string[];
  private publisher: string[];
  private tags: string[];

  constructor(initialMeta?: MangaMiraiSearchMeta) {
    super();
    this.order = initialMeta?.order ?? [];
    this.genre = initialMeta?.genre ?? [];
    this.publisher = initialMeta?.publisher ?? [];
    this.tags = initialMeta?.tags ?? [];
  }

  async updateOrder(value: string[]): Promise<void> {
    this.order = value;
    this.reloadForm();
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  async updatePublisher(value: string[]): Promise<void> {
    this.publisher = value;
    this.reloadForm();
  }

  async updateTags(value: string[]): Promise<void> {
    this.tags = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        order: this.order,
        genre: this.genre,
        publisher: this.publisher,
        tags: this.tags,
      } satisfies MangaMiraiSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("order", {
          title: "Sort By",
          value: this.order,
          options: ORDER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaMiraiSearchForm,
            "updateOrder",
          ),
        }),
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaMiraiSearchForm,
            "updateGenre",
          ),
        }),
        SelectRow("publisher", {
          title: "Publisher",
          value: this.publisher,
          options: PUBLISHER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaMiraiSearchForm,
            "updatePublisher",
          ),
        }),
        SelectRow("tags", {
          title: "Tags",
          value: this.tags,
          options: TAG_OPTIONS,
          minItemCount: 0,
          maxItemCount: TAG_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaMiraiSearchForm,
            "updateTags",
          ),
        }),
      ]),
    ];
  }
}
