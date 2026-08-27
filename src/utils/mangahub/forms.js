import { AdvancedSearchForm, InputRow, Section, SelectRow, } from "@paperback/types";
export const ORDER_BY_OPTIONS = [
    { id: "POPULAR", label: "Popular" },
    { id: "LATEST", label: "Updates" },
    { id: "ALPHABET", label: "A-Z" },
    { id: "NEW", label: "New" },
    { id: "COMPLETED", label: "Completed" },
];
/**
 * Advanced search form for MangaHub sources: an order-by selector plus a
 * free-text genre input (MangaHub's GraphQL `genre` arg accepts a single
 * genre slug, or "all").
 */
export class MangaHubSearchForm extends AdvancedSearchForm {
    requiresExplicitSubmission = true;
    orderBy;
    genre;
    constructor(initialMeta) {
        super();
        this.orderBy = initialMeta?.orderBy ?? [];
        this.genre = initialMeta?.genre ?? "";
    }
    async updateOrderBy(value) {
        this.orderBy = value;
        this.reloadForm();
    }
    async updateGenre(value) {
        this.genre = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            orderBy: this.orderBy,
            genre: this.genre,
        };
    }
    getSections() {
        return [
            Section({ id: "order" }, [
                SelectRow("order_by", {
                    title: "Order By",
                    value: this.orderBy,
                    options: ORDER_BY_OPTIONS.map((opt) => ({
                        id: opt.id,
                        title: opt.label,
                    })),
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateOrderBy"),
                }),
            ]),
            Section({
                id: "genre",
                footer: "Filter by a single genre slug (e.g. action, romance). Leave " +
                    "empty for all genres.",
            }, [
                InputRow("genre_input", {
                    title: "Genre",
                    value: this.genre,
                    onValueChange: Application.Selector(this, "updateGenre"),
                }),
            ]),
        ];
    }
}
