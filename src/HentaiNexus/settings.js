import { Form, Section, SelectRow } from "@paperback/types";
export const IMAGE_FORMAT_OPTIONS = [
    { id: "source", title: "Original" },
    { id: "webp", title: "WebP" },
    { id: "avif", title: "AVIF" },
];
export const DEFAULT_IMAGE_FORMAT = "webp";
const IMAGE_FORMAT_KEY = "pref_image_format";
export function getImageFormat() {
    const value = Application.getState(IMAGE_FORMAT_KEY);
    if (typeof value === "string" &&
        IMAGE_FORMAT_OPTIONS.some((option) => option.id === value)) {
        return value;
    }
    return DEFAULT_IMAGE_FORMAT;
}
function setImageFormat(value) {
    Application.setState(value, IMAGE_FORMAT_KEY);
}
export function getImageFormatLabel(format) {
    return (IMAGE_FORMAT_OPTIONS.find((option) => option.id === format)?.title ?? format);
}
export function getImageField(format) {
    switch (format) {
        case "source":
            return "image_source";
        case "avif":
            return "image_avif";
        default:
            return "image_fallback";
    }
}
export class HentaiNexusSettingsForm extends Form {
    imageFormat;
    constructor() {
        super();
        this.imageFormat = getImageFormat();
    }
    async updateImageFormat(value) {
        const selected = value[0] ?? DEFAULT_IMAGE_FORMAT;
        this.imageFormat = selected;
        setImageFormat(selected);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({
                id: "image",
                footer: "Original quality requires a user account.",
            }, [
                SelectRow("image_format_select", {
                    title: "Image Quality",
                    value: [this.imageFormat],
                    options: IMAGE_FORMAT_OPTIONS,
                    minItemCount: 1,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateImageFormat"),
                }),
            ]),
        ];
    }
}
