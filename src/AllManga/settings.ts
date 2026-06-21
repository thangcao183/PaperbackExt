import { Form, Section, SelectRow, ToggleRow } from "@paperback/types";

export const IMAGE_QUALITY_OPTIONS = [
  { id: "original", title: "Original" },
  { id: "800", title: "Wp-800" },
  { id: "480", title: "Wp-480" },
];

const SHOW_ADULT_KEY = "allmanga.showAdult";
const IMAGE_QUALITY_KEY = "allmanga.imageQuality";

export function getShowAdult(): boolean {
  const value = Application.getState(SHOW_ADULT_KEY);
  return typeof value === "boolean" ? value : false;
}

function setShowAdult(value: boolean): void {
  Application.setState(value, SHOW_ADULT_KEY);
}

export function getImageQuality(): string {
  const value = Application.getState(IMAGE_QUALITY_KEY);
  return typeof value === "string" && value.length > 0 ? value : "original";
}

function setImageQuality(value: string): void {
  Application.setState(value, IMAGE_QUALITY_KEY);
}

export class AllMangaSettingsForm extends Form {
  private showAdult: boolean;
  private imageQuality: string;

  constructor() {
    super();
    this.showAdult = getShowAdult();
    this.imageQuality = getImageQuality();
  }

  async updateShowAdult(value: boolean): Promise<void> {
    this.showAdult = value;
    setShowAdult(value);
    this.reloadForm();
  }

  async updateImageQuality(value: string[]): Promise<void> {
    const selected = value[0] ?? "original";
    this.imageQuality = selected;
    setImageQuality(selected);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section({ id: "content", footer: "Show adult content in results." }, [
        ToggleRow("show_adult", {
          title: "Show adult content",
          value: this.showAdult,
          onValueChange: Application.Selector<
            AllMangaSettingsForm,
            (value: boolean) => Promise<void>
          >(this, "updateShowAdult"),
        }),
      ]),
      Section({ id: "image", footer: "Image quality (resizing CDN)." }, [
        SelectRow("image_quality", {
          title: "Image quality",
          value: [this.imageQuality],
          options: IMAGE_QUALITY_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            AllMangaSettingsForm,
            (value: string[]) => Promise<void>
          >(this, "updateImageQuality"),
        }),
      ]),
    ];
  }
}
