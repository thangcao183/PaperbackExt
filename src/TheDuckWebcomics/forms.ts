import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface TheDuckWebcomicsSearchMeta extends JSONObject {
  type: string[];
  tone: string[];
  style: string[];
  genre: string[];
  rating: string[];
  lastUpdate: string[];
}

export const TYPE_OPTIONS: { id: string; title: string }[] = [
  { id: "0", title: "Comic Strip" },
  { id: "1", title: "Comic Book/Story" },
];

export const TONE_OPTIONS: { id: string; title: string }[] = [
  { id: "0", title: "Comedy" },
  { id: "1", title: "Drama" },
  { id: "3", title: "Other" },
];

export const STYLE_OPTIONS: { id: string; title: string }[] = [
  { id: "0", title: "Cartoon" },
  { id: "1", title: "American" },
  { id: "2", title: "Manga" },
  { id: "3", title: "Realism" },
  { id: "4", title: "Sprite" },
  { id: "5", title: "Sketch" },
  { id: "6", title: "Experimental" },
  { id: "7", title: "Photographic" },
  { id: "8", title: "Stick Figure" },
];

export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "0", title: "Fantasy" },
  { id: "1", title: "Parody" },
  { id: "2", title: "Real Life" },
  { id: "4", title: "Sci-Fi" },
  { id: "5", title: "Horror" },
  { id: "6", title: "Abstract" },
  { id: "8", title: "Adventure" },
  { id: "9", title: "Noir" },
  { id: "12", title: "Political" },
  { id: "13", title: "Spiritual" },
  { id: "14", title: "Romance" },
  { id: "15", title: "Superhero" },
  { id: "16", title: "Western" },
  { id: "17", title: "Mystery" },
  { id: "18", title: "War" },
  { id: "19", title: "Tribute" },
];

export const RATING_OPTIONS: { id: string; title: string }[] = [
  { id: "E", title: "Everyone" },
  { id: "T", title: "Teen" },
  { id: "M", title: "Mature" },
  { id: "A", title: "Adult" },
];

export const LAST_UPDATE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "Any" },
  { id: "today", title: "Today" },
  { id: "week", title: "Last week" },
  { id: "month", title: "Last month" },
];

export class TheDuckWebcomicsSearchForm extends AdvancedSearchForm {
  private type: string[];
  private tone: string[];
  private style: string[];
  private genre: string[];
  private rating: string[];
  private lastUpdate: string[];

  constructor(initialMeta?: TheDuckWebcomicsSearchMeta) {
    super();
    this.type = initialMeta?.type ?? [];
    this.tone = initialMeta?.tone ?? [];
    this.style = initialMeta?.style ?? [];
    this.genre = initialMeta?.genre ?? [];
    this.rating = initialMeta?.rating ?? [];
    this.lastUpdate = initialMeta?.lastUpdate ?? [];
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  async updateTone(value: string[]): Promise<void> {
    this.tone = value;
    this.reloadForm();
  }

  async updateStyle(value: string[]): Promise<void> {
    this.style = value;
    this.reloadForm();
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  async updateRating(value: string[]): Promise<void> {
    this.rating = value;
    this.reloadForm();
  }

  async updateLastUpdate(value: string[]): Promise<void> {
    this.lastUpdate = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        type: this.type,
        tone: this.tone,
        style: this.style,
        genre: this.genre,
        rating: this.rating,
        lastUpdate: this.lastUpdate,
      } satisfies TheDuckWebcomicsSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("type", {
          title: "Type of comic",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateType",
          ),
        }),
        SelectRow("tone", {
          title: "Tone",
          value: this.tone,
          options: TONE_OPTIONS,
          minItemCount: 0,
          maxItemCount: TONE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateTone",
          ),
        }),
        SelectRow("style", {
          title: "Art style",
          value: this.style,
          options: STYLE_OPTIONS,
          minItemCount: 0,
          maxItemCount: STYLE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateStyle",
          ),
        }),
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateGenre",
          ),
        }),
        SelectRow("rating", {
          title: "Rating",
          value: this.rating,
          options: RATING_OPTIONS,
          minItemCount: 0,
          maxItemCount: RATING_OPTIONS.length,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateRating",
          ),
        }),
        SelectRow("last_update", {
          title: "Last update",
          value: this.lastUpdate,
          options: LAST_UPDATE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as TheDuckWebcomicsSearchForm,
            "updateLastUpdate",
          ),
        }),
      ]),
    ];
  }
}
