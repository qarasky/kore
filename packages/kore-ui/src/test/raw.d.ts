// Minimal typing for the one Node API the theme drift test uses (the package has no @types/node).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
