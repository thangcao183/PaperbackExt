import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow, } from "@paperback/types";
const BASE_URL_KEY_PREFIX = "foolslide.baseUrlOverride.";
const SHOW_ADULT_KEY_PREFIX = "foolslide.showAdult.";
function baseUrlKey(sourceName) {
    return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}
function showAdultKey(sourceName) {
    return `${SHOW_ADULT_KEY_PREFIX}${sourceName}`;
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
 * Whether adult content should be requested. Defaults to true (matching the
 * FoolSlide base class default).
 */
export function getShowAdult(sourceName) {
    const value = Application.getState(showAdultKey(sourceName));
    return typeof value === "boolean" ? value : true;
}
function setShowAdult(sourceName, value) {
    Application.setState(value, showAdultKey(sourceName));
}
export class FoolSlideSettingsForm extends Form {
    sourceName;
    defaultBaseUrl;
    override;
    showAdult;
    constructor(sourceName, defaultBaseUrl) {
        super();
        this.sourceName = sourceName;
        this.defaultBaseUrl = defaultBaseUrl;
        this.override = getBaseUrlOverride(sourceName) ?? "";
        this.showAdult = getShowAdult(sourceName);
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
    async updateShowAdult(value) {
        this.showAdult = value;
        setShowAdult(this.sourceName, value);
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
                id: "content",
                footer: "Allow adult content to be returned by this source. Disable to " +
                    "hide adult titles where the site supports filtering.",
            }, [
                ToggleRow("show_adult", {
                    title: "Show adult content",
                    value: this.showAdult,
                    onValueChange: Application.Selector(this, "updateShowAdult"),
                }),
            ]),
        ];
    }
}
