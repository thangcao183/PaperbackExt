import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface AsiaToonSearchMeta extends JSONObject {
  browse: string[];
}

// Browse entries: title -> uri path segment(s)
export const BROWSE_OPTIONS: { id: string; title: string }[] = [
  { id: "en", title: "Home" },
  { id: "en/genres/New", title: "New" },
  { id: "en/completed", title: "Completed" },
  { id: "en/pages/honey-toon", title: "Page: Honey Toon" },
  { id: "en/pages/manhwa-toon", title: "Page: Manhwa toon" },
  { id: "en/pages/manga-toon", title: "Page: Manga toon" },
  { id: "en/pages/comics-toon", title: "Page: Comics toon" },
  { id: "en/pages/toon-god", title: "Page: Toon God" },
  { id: "en/pages/toon-porn", title: "Page: Toon Porn" },
  { id: "en/genres", title: "Genre: All" },
  { id: "en/genres/Vanilla", title: "Genre: Vanilla" },
  { id: "en/genres/Monster_Girls", title: "Genre: Monster Girls" },
  { id: "en/genres/School_Life", title: "Genre: School Life" },
  { id: "en/genres/Horror_Thriller", title: "Genre: Horror Thriller" },
  { id: "en/genres/Slice_of_Life", title: "Genre: Slice of Life" },
  { id: "en/genres/Supernatural", title: "Genre: Supernatural" },
  { id: "en/genres/Office", title: "Genre: Office" },
  { id: "en/genres/Sexy", title: "Genre: Sexy" },
  { id: "en/genres/MILF", title: "Genre: MILF" },
  { id: "en/genres/In-Law", title: "Genre: In-Law" },
  { id: "en/genres/Harem", title: "Genre: Harem" },
  { id: "en/genres/Cheating", title: "Genre: Cheating" },
  { id: "en/genres/College", title: "Genre: College" },
  { id: "en/genres/Isekai", title: "Genre: Isekai" },
  { id: "en/genres/UNCENSORED", title: "Genre: UNCENSORED" },
  { id: "en/genres/GL", title: "Genre: GL" },
  { id: "en/genres/sexy_comics", title: "Genre: sexy comics" },
  { id: "en/genres/Sci-fi", title: "Genre: Sci-fi" },
  { id: "en/genres/Sports", title: "Genre: Sports" },
  { id: "en/genres/School_life", title: "Genre: School life" },
  { id: "en/genres/Historical", title: "Genre: Historical" },
  { id: "en/genres/Action", title: "Genre: Action" },
  { id: "en/genres/Thriller", title: "Genre: Thriller" },
  { id: "en/genres/Horror", title: "Genre: Horror" },
  { id: "en/genres/Fantasy", title: "Genre: Fantasy" },
  { id: "en/genres/Comedy", title: "Genre: Comedy" },
  { id: "en/genres/Drama", title: "Genre: Drama" },
  { id: "en/genres/BL", title: "Genre: BL" },
  { id: "en/genres/Romance", title: "Genre: Romance" },
];

export class AsiaToonSearchForm extends AdvancedSearchForm {
  private browse: string[];

  constructor(initialMeta?: AsiaToonSearchMeta) {
    super();
    this.browse = initialMeta?.browse ?? [];
  }

  async updateBrowse(value: string[]): Promise<void> {
    this.browse = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        browse: this.browse,
      } satisfies AsiaToonSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("browse", {
          title: "Browse",
          value: this.browse,
          options: BROWSE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as AsiaToonSearchForm,
            "updateBrowse",
          ),
        }),
      ]),
    ];
  }
}
