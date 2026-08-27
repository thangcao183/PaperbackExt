import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
export const TYPE_OPTIONS = [
    { id: "1", title: "Comic" },
    { id: "2", title: "Manga" },
    { id: "3", title: "Manhwa" },
    { id: "4", title: "Manhua" },
    { id: "5", title: "Webtoon" },
];
export const STATUS_OPTIONS = [
    { id: "1", title: "Ongoing" },
    { id: "2", title: "Completed" },
    { id: "3", title: "Hiatus" },
    { id: "4", title: "Cancelled" },
    { id: "5", title: "Dropped" },
];
export const TAG_OPTIONS = [
    { id: "1", title: "Fantasy" },
    { id: "2", title: "Romance" },
    { id: "3", title: "Shoujo" },
    { id: "4", title: "Comedy" },
    { id: "5", title: "Drama" },
    { id: "6", title: "Slice Of Life" },
    { id: "7", title: "School Life" },
    { id: "8", title: "Thriller" },
    { id: "9", title: "Josei" },
    { id: "10", title: "Action" },
    { id: "11", title: "Seinen" },
    { id: "12", title: "Historical" },
    { id: "13", title: "Shounen" },
    { id: "14", title: "Sports" },
    { id: "15", title: "Supernatural" },
    { id: "16", title: "Adventure" },
    { id: "17", title: "Sci-fi" },
    { id: "18", title: "Martial Arts" },
    { id: "19", title: "Mystery" },
    { id: "20", title: "Horror" },
    { id: "21", title: "Mature" },
    { id: "22", title: "Psychological" },
    { id: "23", title: "Suspense" },
    { id: "24", title: "Gender Bender" },
    { id: "25", title: "Tragedy" },
    { id: "26", title: "Harem" },
    { id: "27", title: "Boys Love" },
    { id: "28", title: "Shounen Ai" },
    { id: "29", title: "Yaoi" },
    { id: "30", title: "Shoujo Ai" },
    { id: "31", title: "Yuri" },
    { id: "32", title: "Gourmet" },
    { id: "33", title: "Adult" },
    { id: "34", title: "Erotica" },
    { id: "35", title: "Smut" },
    { id: "36", title: "Music" },
    { id: "37", title: "Ecchi" },
    { id: "38", title: "Shotacon" },
    { id: "39", title: "Mecha" },
    { id: "40", title: "Hentai" },
    { id: "41", title: "Girls Love" },
    { id: "42", title: "Doujinshi" },
    { id: "43", title: "Mahou Shoujo" },
    { id: "44", title: "Lolicon" },
    { id: "45", title: "Award Winning" },
    { id: "46", title: "Avant Garde" },
    { id: "47", title: "Survival" },
    { id: "48", title: "Male Protagonist" },
    { id: "49", title: "Regression" },
];
export class ScansGGSearchForm extends AdvancedSearchForm {
    types;
    statuses;
    tags;
    constructor(initialMeta) {
        super();
        this.types = initialMeta?.types ?? [];
        this.statuses = initialMeta?.statuses ?? [];
        this.tags = initialMeta?.tags ?? [];
    }
    async updateTypes(value) {
        this.types = value;
        this.reloadForm();
    }
    async updateStatuses(value) {
        this.statuses = value;
        this.reloadForm();
    }
    async updateTags(value) {
        this.tags = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                types: this.types,
                statuses: this.statuses,
                tags: this.tags,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("types", {
                    title: "Type",
                    value: this.types,
                    options: TYPE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TYPE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateTypes"),
                }),
                SelectRow("statuses", {
                    title: "Status",
                    value: this.statuses,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: STATUS_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateStatuses"),
                }),
                SelectRow("tags", {
                    title: "Tags",
                    value: this.tags,
                    options: TAG_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: TAG_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateTags"),
                }),
            ]),
        ];
    }
}
