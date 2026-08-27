import { ButtonRow, Form, InputRow, LabelRow, Section, } from "@paperback/types";
const BASE_URL_KEY_PREFIX = "monochrome.baseUrlOverride.";
const API_URL_KEY_PREFIX = "monochrome.apiUrlOverride.";
function baseUrlKey(sourceName) {
    return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}
function apiUrlKey(sourceName) {
    return `${API_URL_KEY_PREFIX}${sourceName}`;
}
/**
 * Returns the user-configured frontend base URL override for a source, or
 * undefined when none is set. Trailing slashes are stripped.
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
 * Returns the user-configured API URL override for a source, or undefined when
 * none is set. Trailing slashes are stripped.
 */
export function getApiUrlOverride(sourceName) {
    const value = Application.getState(apiUrlKey(sourceName));
    if (typeof value === "string") {
        const trimmed = value.trim().replace(/\/+$/, "");
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return undefined;
}
function setApiUrlOverride(sourceName, value) {
    const trimmed = value.trim().replace(/\/+$/, "");
    Application.setState(trimmed, apiUrlKey(sourceName));
}
/**
 * Settings form for a Monochrome source. Lets the user override both the
 * frontend base URL and the API URL (required for self-hosted installations).
 */
export class MonochromeSettingsForm extends Form {
    sourceName;
    defaultBaseUrl;
    defaultApiUrl;
    baseOverride;
    apiOverride;
    constructor(sourceName, defaultBaseUrl, defaultApiUrl) {
        super();
        this.sourceName = sourceName;
        this.defaultBaseUrl = defaultBaseUrl;
        this.defaultApiUrl = defaultApiUrl;
        this.baseOverride = getBaseUrlOverride(sourceName) ?? "";
        this.apiOverride = getApiUrlOverride(sourceName) ?? "";
    }
    async updateBaseOverride(value) {
        this.baseOverride = value;
        setBaseUrlOverride(this.sourceName, value);
        this.reloadForm();
    }
    async resetBaseOverride() {
        this.baseOverride = "";
        setBaseUrlOverride(this.sourceName, "");
        this.reloadForm();
    }
    async updateApiOverride(value) {
        this.apiOverride = value;
        setApiUrlOverride(this.sourceName, value);
        this.reloadForm();
    }
    async resetApiOverride() {
        this.apiOverride = "";
        setApiUrlOverride(this.sourceName, "");
        this.reloadForm();
    }
    getSections() {
        const effectiveBase = this.baseOverride.trim().length > 0
            ? this.baseOverride.trim().replace(/\/+$/, "")
            : this.defaultBaseUrl;
        const effectiveApi = this.apiOverride.trim().length > 0
            ? this.apiOverride.trim().replace(/\/+$/, "")
            : this.defaultApiUrl;
        return [
            Section({
                id: "base_url",
                footer: "Override the frontend address if this source has moved to a new " +
                    "domain, or to point at your own Monochrome installation. Leave " +
                    `empty to use the default. Include the scheme, e.g. ${this.defaultBaseUrl}`,
            }, [
                InputRow("base_url_input", {
                    title: "Frontend URL",
                    value: this.baseOverride,
                    onValueChange: Application.Selector(this, "updateBaseOverride"),
                }),
                LabelRow("base_url_current", {
                    title: "Currently using",
                    value: effectiveBase,
                }),
                ButtonRow("base_url_reset", {
                    title: "Reset to default",
                    onSelect: Application.Selector(this, "resetBaseOverride"),
                }),
            ]),
            Section({
                id: "api_url",
                footer: "Override the API address. Required when self-hosting Monochrome " +
                    "with a custom API endpoint. Leave empty to use the default.",
            }, [
                InputRow("api_url_input", {
                    title: "API URL",
                    value: this.apiOverride,
                    onValueChange: Application.Selector(this, "updateApiOverride"),
                }),
                LabelRow("api_url_current", {
                    title: "Currently using",
                    value: effectiveApi,
                }),
                ButtonRow("api_url_reset", {
                    title: "Reset to default",
                    onSelect: Application.Selector(this, "resetApiOverride"),
                }),
            ]),
        ];
    }
}
