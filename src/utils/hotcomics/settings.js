import { ButtonRow, Form, InputRow, LabelRow, Section, } from "@paperback/types";
const BASE_URL_KEY_PREFIX = "hotcomics.baseUrlOverride.";
function baseUrlKey(sourceName) {
    return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}
export function getBaseUrlOverride(sourceName) {
    const stored = Application.getState(baseUrlKey(sourceName));
    if (typeof stored !== "string") {
        return undefined;
    }
    const trimmed = stored.trim().replace(/\/+$/, "");
    return trimmed.length > 0 ? trimmed : undefined;
}
export function setBaseUrlOverride(sourceName, value) {
    Application.setState(value ?? "", baseUrlKey(sourceName));
}
export class HotComicsSettingsForm extends Form {
    sourceName;
    defaultBaseUrl;
    override;
    constructor(sourceName, defaultBaseUrl) {
        super();
        this.sourceName = sourceName;
        this.defaultBaseUrl = defaultBaseUrl;
        this.override = getBaseUrlOverride(sourceName) ?? "";
    }
    async updateOverride(value) {
        this.override = value;
        setBaseUrlOverride(this.sourceName, value);
        this.reloadForm();
    }
    async resetOverride() {
        this.override = "";
        setBaseUrlOverride(this.sourceName, undefined);
        this.reloadForm();
    }
    getSections() {
        const effective = getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
        return [
            Section({
                id: "base_url",
                footer: `Override the site address if the domain has changed. Default: ${this.defaultBaseUrl}`,
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
        ];
    }
}
