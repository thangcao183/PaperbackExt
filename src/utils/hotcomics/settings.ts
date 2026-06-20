import {
    ButtonRow,
    Form,
    InputRow,
    LabelRow,
    Section,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "hotcomics.baseUrlOverride.";

function baseUrlKey(sourceName: string): string {
    return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

export function getBaseUrlOverride(sourceName: string): string | undefined {
    const stored = Application.getState(baseUrlKey(sourceName)) as
        | string
        | undefined;
    if (typeof stored !== "string") {
        return undefined;
    }
    const trimmed = stored.trim().replace(/\/+$/, "");
    return trimmed.length > 0 ? trimmed : undefined;
}

export function setBaseUrlOverride(
    sourceName: string,
    value: string | undefined,
): void {
    Application.setState(value ?? "", baseUrlKey(sourceName));
}

export class HotComicsSettingsForm extends Form {
    private override: string;

    constructor(
        private readonly sourceName: string,
        private readonly defaultBaseUrl: string,
    ) {
        super();
        this.override = getBaseUrlOverride(sourceName) ?? "";
    }

    async updateOverride(value: string): Promise<void> {
        this.override = value;
        setBaseUrlOverride(this.sourceName, value);
        this.reloadForm();
    }

    async resetOverride(): Promise<void> {
        this.override = "";
        setBaseUrlOverride(this.sourceName, undefined);
        this.reloadForm();
    }

    override getSections() {
        const effective = getBaseUrlOverride(this.sourceName) ?? this.defaultBaseUrl;
        return [
            Section(
                {
                    id: "base_url",
                    footer: `Override the site address if the domain has changed. Default: ${this.defaultBaseUrl}`,
                },
                [
                    InputRow("base_url_input", {
                        title: "Base URL",
                        value: this.override,
                        onValueChange: Application.Selector<
                            HotComicsSettingsForm,
                            (value: string) => Promise<void>
                        >(this, "updateOverride"),
                    }),
                    LabelRow("base_url_current", {
                        title: "Currently using",
                        value: effective,
                    }),
                    ButtonRow("base_url_reset", {
                        title: "Reset to default",
                        onSelect: Application.Selector<
                            HotComicsSettingsForm,
                            () => Promise<void>
                        >(this, "resetOverride"),
                    }),
                ],
            ),
        ];
    }
}
