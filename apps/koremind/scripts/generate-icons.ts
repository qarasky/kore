// Regenerates every copy of the Zero mark from scripts/icons.ts. Never hand-edit the outputs.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { androidForeground, markSvg } from "./icons";

const root = join(import.meta.dir, "..");
writeFileSync(join(root, "assets/mark.svg"), markSvg());
writeFileSync(join(root, "web/app/icon.svg"), markSvg());
writeFileSync(join(root, "android/app/src/main/res/drawable/ic_launcher_foreground.xml"), androidForeground());
console.log("icons regenerated");
