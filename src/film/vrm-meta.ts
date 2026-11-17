// Read a VRM's licence fields straight from the .vrm (glTF binary) file, so a
// monetized film never uses a model whose author forbids commercial use.
import { readFileSync } from "node:fs";

export interface VrmLicence {
  name: string;
  authors: string;
  commercial: boolean;
  creditRequired: boolean;
  note: string;
  licenseUrl: string;
}

export function readVrmLicence(path: string): VrmLicence {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "glTF") throw new Error(`${path} không phải file VRM/glb`);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.toString("utf8", 20, 20 + len));
  const v1 = j.extensions?.VRMC_vrm?.meta;
  if (v1) {
    return {
      name: v1.name ?? "",
      authors: (v1.authors ?? []).join(", "),
      commercial: ["personalProfit", "corporation"].includes(v1.commercialUsage),
      creditRequired: v1.creditNotation === "required",
      note: `commercialUsage=${v1.commercialUsage}, avatarPermission=${v1.avatarPermission}`,
      licenseUrl: v1.licenseUrl ?? "",
    };
  }
  const v0 = j.extensions?.VRM?.meta;
  if (v0) {
    return {
      name: v0.title ?? "",
      authors: v0.author ?? "",
      commercial: v0.commercialUssageName === "Allow",
      creditRequired: true, // VRM 0.x has no field for it: credit to be safe
      note: `commercialUssageName=${v0.commercialUssageName}, license=${v0.licenseName}`,
      licenseUrl: v0.otherLicenseUrl ?? "",
    };
  }
  throw new Error(`${path}: không có thông tin VRM`);
}
