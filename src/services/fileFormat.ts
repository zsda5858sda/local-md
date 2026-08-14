import chardet from "chardet";
import iconv from "iconv-lite";
import { Buffer } from "buffer";
import type { FileFormatProfile } from "../domain/types";
import { t } from "../i18n";

const ENCODING_MAP: Record<string, FileFormatProfile["encoding"]> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  big5: "big5",
  gb18030: "gbk",
  gb2312: "gbk",
  gbk: "gbk",
  shift_jis: "shift_jis",
  sjis: "shift_jis",
};

export interface DecodedFile {
  text: string;
  profile: FileFormatProfile;
  confidence: number;
}

export function detectEol(text: string): FileFormatProfile["eol"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrLf = text.replace(/\r\n/g, "");
  const cr = (withoutCrLf.match(/\r/g) ?? []).length;
  const lf = (withoutCrLf.match(/\n/g) ?? []).length;
  if (crlf >= cr && crlf >= lf && crlf > 0) return "crlf";
  if (cr > lf && cr > 0) return "cr";
  return "lf";
}

export function decodeFile(bytes: Uint8Array, confidenceThreshold = 0.55): DecodedFile {
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = hasBom ? bytes.slice(3) : bytes;
  const detected = hasBom ? [{ name: "UTF-8", confidence: 100 }] : chardet.analyse(payload);
  const first = detected[0];
  const normalizedName = String(first?.name ?? "").toLowerCase().replace(/-/g, "_");
  const encoding = ENCODING_MAP[normalizedName] ?? ENCODING_MAP[normalizedName.replace(/_/g, "-")];
  const confidence = Number(first?.confidence ?? 0) / 100;
  if (!encoding || confidence < confidenceThreshold) {
    throw new Error(t("encoding.uncertain", { name: first?.name ?? "unknown", confidence: Math.round(confidence * 100) }));
  }
  const decoded = iconv.decode(Buffer.from(payload), encoding);
  return {
    text: decoded.replace(/\r\n?/g, "\n"),
    profile: { encoding, bom: hasBom ? "utf8" : "none", eol: detectEol(decoded) },
    confidence,
  };
}

export function encodeFile(text: string, profile: FileFormatProfile): Uint8Array {
  const eol = profile.eol === "crlf" ? "\r\n" : profile.eol === "cr" ? "\r" : "\n";
  const diskText = text.replace(/\r\n?/g, "\n").replace(/\n/g, eol);
  const encoded = iconv.encode(diskText, profile.encoding);
  const roundTrip = iconv.decode(encoded, profile.encoding);
  if (roundTrip !== diskText) {
    throw new Error(t("encoding.lossy", { encoding: profile.encoding }));
  }
  if (profile.bom === "utf8" && profile.encoding === "utf-8") {
    return Uint8Array.from([0xef, 0xbb, 0xbf, ...encoded]);
  }
  return Uint8Array.from(encoded);
}

export const UTF8_LF: FileFormatProfile = { encoding: "utf-8", bom: "none", eol: "lf" };
