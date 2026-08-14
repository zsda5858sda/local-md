import { t } from "../i18n";

const INVALID_NAME = /[\\/:*?"<>|]/;

export function validateEntryName(raw: string): string | null {
  if (INVALID_NAME.test(raw)) {
    return t("validation.invalidEntryName");
  }
  return null;
}
