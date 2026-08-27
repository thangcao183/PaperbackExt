import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const TYPE_OPTIONS = [
    { id: "0", title: "Comic Strip" },
    { id: "1", title: "Comic Book/Story" },
];
export const TONE_OPTIONS = [
    { id: "0", title: "Comedy" },
    { id: "1", title: "Drama" },
    { id: "3", title: "Other" },
];
export const STYLE_OPTIONS = [
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
export const GENRE_OPTIONS = [
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
export const RATING_OPTIONS = [
    { id: "E", title: "Everyone" },
    { id: "T", title: "Teen" },
    { id: "M", title: "Mature" },
    { id: "A", title: "Adult" },
];
export const LAST_UPDATE_OPTIONS = [
    { id: "", title: "Any" },
    { id: "today", title: "Today" },
    { id: "week", title: "Last week" },
    { id: "month", title: "Last month" },
];
export class TheDuckWebcomicsSearchForm extends AdvancedSearchForm {
    type;
    tone;
    style;
    genre;
    rating;
    lastUpdate;
    constructor(initialMeta) {
        super();
        this.type = initialMeta?.type ?? [];
        this.tone = initialMeta?.tone ?? [];
        this.style = initialMeta?.style ?? [];
        this.genre = initialMeta?.genre ?? [];
        this.rating = initialMeta?.rating ?? [];
        this.lastUpdate = initialMeta?.lastUpdate ?? [];
    }
    async updateType(value) {
        this.type = value;
        this.reloadForm();
    }
    async updateTone(value) {
        this.tone = value;
        this.reloadForm();
    }
    async updateStyle(value) {
        this.style = value;
        this.reloadForm();
    }
    async updateGenre(value) {
        this.genre = value;
        this.reloadForm();
    }
    async updateRating(value) {
        this.rating = value;
        this.reloadForm();
    }
    async updateLastUpdate(value) {
        this.lastUpdate = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                type: this.type,
                tone: this.tone,
                style: this.style,
                genre: this.genre,
                rating: this.rating,
                lastUpdate: this.lastUpdate,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("type", {
                    title: "Type of comic",
                    value: this.type,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TYPE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateType"),
                }),
                SelectRow("tone", {
                    title: "Tone",
                    value: this.tone,
                    options: TONE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TONE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateTone"),
                }),
                SelectRow("style", {
                    title: "Art style",
                    value: this.style,
                    options: STYLE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: STYLE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateStyle"),
                }),
                SelectRow("genre", {
                    title: "Genre",
                    value: this.genre,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateGenre"),
                }),
                SelectRow("rating", {
                    title: "Rating",
                    value: this.rating,
                    options: RATING_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: RATING_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateRating"),
                }),
                SelectRow("last_update", {
                    title: "Last update",
                    value: this.lastUpdate,
                    options: LAST_UPDATE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateLastUpdate"),
                }),
            ]),
        ];
    }
}
