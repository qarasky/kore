/**
 * Prettier configuration for KoreMonitor.
 *
 * The whole repository follows this style: `npm run fmt` writes it, and
 * `npm run fmt:check` verifies it without touching anything.
 *
 * Rust and Go are not covered: `backend-rs/` is kept `cargo fmt` clean and Go
 * `gofmt` clean.
 */
module.exports = {
    // Core formatting options
    semi: true,
    singleQuote: false,
    trailingComma: "es5",
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    endOfLine: "lf",
    arrowParens: "always",
    bracketSpacing: true,
    bracketSameLine: false,

    // Override settings for specific file types
    overrides: [
        {
            files: ["*.json", "*.jsonc"],
            options: {
                tabWidth: 4,
                trailingComma: "none",
            },
        },
        {
            files: ["*.yml", "*.yaml"],
            options: {
                tabWidth: 2,
                trailingComma: "none",
            },
        },
        {
            files: ["*.md"],
            options: {
                printWidth: 100,
                proseWrap: "preserve",
                tabWidth: 2,
            },
        },
    ],
};
