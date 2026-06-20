import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "monochrome.baseUrlOverride.";
const API_URL_KEY_PREFIX = "monochrome.apiUrlOverride.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

function apiUrlKey(sourceName: string): string {
  return `${API_URL_KEY_PREFIX}${sourceName}`;
}

/**
 * Returns the user-configured frontend base URL override for a source, or
 * undefined when none is set. Trailing slashes are stripped.
 */
export function getBaseUrlOverride(sourceName: string): string | undefined {
  const value = Application.getState(baseUrlKey(sourceName));
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function setBaseUrlOverride(sourceName: string, value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(trimmed, baseUrlKey(sourceName));
}

/**
 * Returns the user-configured API URL override for a source, or undefined when
 * none is set. Trailing slashes are stripped.
 */
export function getApiUrlOverride(sourceName: string): string | undefined {
  const value = Application.getState(apiUrlKey(sourceName));
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function setApiUrlOverride(sourceName: string, value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(trimmed, apiUrlKey(sourceName));
}

/**
 * Settings form for a Monochrome source. Lets the user override both the
 * frontend base URL and the API URL (required for self-hosted installations).
 */
export class MonochromeSettingsForm extends Form {
  private baseOverride: string;
  private apiOverride: string;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
    private readonly defaultApiUrl: string,
  ) {
    super();
    this.baseOverride = getBaseUrlOverride(sourceName) ?? "";
    this.apiOverride = getApiUrlOverride(sourceName) ?? "";
  }

  async updateBaseOverride(value: string): Promise<void> {
    this.baseOverride = value;
    setBaseUrlOverride(this.sourceName, value);
    this.reloadForm();
  }

  async resetBaseOverride(): Promise<void> {
    this.baseOverride = "";
    setBaseUrlOverride(this.sourceName, "");
    this.reloadForm();
  }

  async updateApiOverride(value: string): Promise<void> {
    this.apiOverride = value;
    setApiUrlOverride(this.sourceName, value);
    this.reloadForm();
  }

  async resetApiOverride(): Promise<void> {
    this.apiOverride = "";
    setApiUrlOverride(this.sourceName, "");
    this.reloadForm();
  }

  override getSections() {
    const effectiveBase =
      this.baseOverride.trim().length > 0
        ? this.baseOverride.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;
    const effectiveApi =
      this.apiOverride.trim().length > 0
        ? this.apiOverride.trim().replace(/\/+$/, "")
        : this.defaultApiUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the frontend address if this source has moved to a new " +
            "domain, or to point at your own Monochrome installation. Leave " +
            `empty to use the default. Include the scheme, e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Frontend URL",
            value: this.baseOverride,
            onValueChange: Application.Selector<
              MonochromeSettingsForm,
              (value: string) => Promise<void>
            >(this, "updateBaseOverride"),
          }),
          LabelRow("base_url_current", {
            title: "Currently using",
            value: effectiveBase,
          }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector<
              MonochromeSettingsForm,
              () => Promise<void>
            >(this, "resetBaseOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "api_url",
          footer:
            "Override the API address. Required when self-hosting Monochrome " +
            "with a custom API endpoint. Leave empty to use the default.",
        },
        [
          InputRow("api_url_input", {
            title: "API URL",
            value: this.apiOverride,
            onValueChange: Application.Selector<
              MonochromeSettingsForm,
              (value: string) => Promise<void>
            >(this, "updateApiOverride"),
          }),
          LabelRow("api_url_current", {
            title: "Currently using",
            value: effectiveApi,
          }),
          ButtonRow("api_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector<
              MonochromeSettingsForm,
              () => Promise<void>
            >(this, "resetApiOverride"),
          }),
        ],
      ),
    ];
  }
}
