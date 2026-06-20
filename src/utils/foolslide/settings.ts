import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "foolslide.baseUrlOverride.";
const SHOW_ADULT_KEY_PREFIX = "foolslide.showAdult.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

function showAdultKey(sourceName: string): string {
  return `${SHOW_ADULT_KEY_PREFIX}${sourceName}`;
}

/**
 * Returns the user-configured base URL override for a source, or undefined
 * when none is set. Trailing slashes are stripped.
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
 * Whether adult content should be requested. Defaults to true (matching the
 * FoolSlide base class default).
 */
export function getShowAdult(sourceName: string): boolean {
  const value = Application.getState(showAdultKey(sourceName));
  return typeof value === "boolean" ? value : true;
}

function setShowAdult(sourceName: string, value: boolean): void {
  Application.setState(value, showAdultKey(sourceName));
}

export class FoolSlideSettingsForm extends Form {
  private override: string;
  private showAdult: boolean;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
  ) {
    super();
    this.override = getBaseUrlOverride(sourceName) ?? "";
    this.showAdult = getShowAdult(sourceName);
  }

  async updateOverride(value: string): Promise<void> {
    this.override = value;
    setBaseUrlOverride(this.sourceName, value);
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.override = "";
    setBaseUrlOverride(this.sourceName, "");
    this.reloadForm();
  }

  async updateShowAdult(value: boolean): Promise<void> {
    this.showAdult = value;
    setShowAdult(this.sourceName, value);
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? this.override.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new " +
            "domain. Leave empty to use the default. Include the scheme, " +
            `e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector<
              FoolSlideSettingsForm,
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
              FoolSlideSettingsForm,
              () => Promise<void>
            >(this, "resetOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "content",
          footer:
            "Allow adult content to be returned by this source. Disable to " +
            "hide adult titles where the site supports filtering.",
        },
        [
          ToggleRow("show_adult", {
            title: "Show adult content",
            value: this.showAdult,
            onValueChange: Application.Selector<
              FoolSlideSettingsForm,
              (value: boolean) => Promise<void>
            >(this, "updateShowAdult"),
          }),
        ],
      ),
    ];
  }
}
