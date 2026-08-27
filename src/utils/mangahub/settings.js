import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow, } from "@paperback/types";
const BASE_URL_KEY_PREFIX = "mangahub.baseUrlOverride.";
const GENERIC_TITLE_KEY_PREFIX = "mangahub.useGenericTitle.";
function baseUrlKey(sourceName) {
    return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}
function genericTitleKey(sourceName) {
    return `${GENERIC_TITLE_KEY_PREFIX}${sourceName}`;
}
/**
 * Returns the user-configured base URL override for a source, or undefined
 * when none is set. Trailing slashes are stripped.
 */
export function getBaseUrlOverride(sourceName) {
    const value = Application.getState(baseUrlKey(sourceName));
    if (typeof value === "string") {
        const trimmed = value.trim().replace(/\/+$/, "");
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return undefined;
}
function setBaseUrlOverride(sourceName, value) {
    const trimmed = value.trim().replace(/\/+$/, "");
    Application.setState(trimmed, baseUrlKey(sourceName));
}
/**
 * Whether generic chapter titles ("Chapter X") should be used instead of the
 * provided ones. Defaults to false.
 */
export function getUseGenericTitle(sourceName) {
    const value = Application.getState(genericTitleKey(sourceName));
    return typeof value === "boolean" ? value : false;
}
function setUseGenericTitle(sourceName, value) {
    Application.setState(value, genericTitleKey(sourceName));
}
/**
 * Settings form for a MangaHub source. Lets the user override the base URL
 * (useful when a mirror changes domain) and toggle generic chapter titles.
 */
export class MangaHubSettingsForm extends Form {
    sourceName;
    defaultBaseUrl;
    override;
    genericTitle;
    constructor(sourceName, defaultBaseUrl) {
        super();
        this.sourceName = sourceName;
        this.defaultBaseUrl = defaultBaseUrl;
        this.override = getBaseUrlOverride(sourceName) ?? "";
        this.genericTitle = getUseGenericTitle(sourceName);
    }
    async updateOverride(value) {
        this.override = value;
        setBaseUrlOverride(this.sourceName, value);
        this.reloadForm();
    }
    async resetOverride() {
        this.override = "";
        setBaseUrlOverride(this.sourceName, "");
        this.reloadForm();
    }
    async updateGenericTitle(value) {
        this.genericTitle = value;
        setUseGenericTitle(this.sourceName, value);
        this.reloadForm();
    }
    getSections() {
        const effective = this.override.trim().length > 0
            ? this.override.trim().replace(/\/+$/, "")
            : this.defaultBaseUrl;
        return [
            Section({
                id: "base_url",
                footer: "Override the site address if this source has moved to a new " +
                    "domain. Leave empty to use the default. Include the scheme, " +
                    `e.g. ${this.defaultBaseUrl}`,
            }, [
                InputRow("base_url_input", {
                    title: "Base URL",
                    value: this.override,
                    onValueChange: Application.Selector(this, "updateOverride"),
                }),
                LabelRow("base_url_current", {
                    title: "Currently using",
                    value: effective,
                }),
                ButtonRow("base_url_reset", {
                    title: "Reset to default",
                    onSelect: Application.Selector(this, "resetOverride"),
                }),
            ]),
            Section({
                id: "chapters",
                footer: 'Use a generic chapter title ("Chapter X") instead of the ' +
                    "provided one.",
            }, [
                ToggleRow("use_generic_title", {
                    title: "Use generic title",
                    value: this.genericTitle,
                    onValueChange: Application.Selector(this, "updateGenericTitle"),
                }),
            ]),
        ];
    }
}
