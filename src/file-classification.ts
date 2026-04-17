const PATH_SEGMENT_START = String.raw`(?:^|[\\/])`;

export const TEST_FILE_RE = new RegExp(
  [
    String.raw`\.test\.`,
    String.raw`\.spec\.`,
    String.raw`_test\.`,
    String.raw`_spec\.`,
    String.raw`${PATH_SEGMENT_START}__tests__[\\/]`,
    String.raw`${PATH_SEGMENT_START}tests?[\\/]`,
    String.raw`${PATH_SEGMENT_START}test_[^\\/]*\.`,
  ].join("|"),
);

export const CONFIG_FILE_RE = new RegExp(
  [
    String.raw`package\.json$`,
    String.raw`package-lock\.json$`,
    String.raw`yarn\.lock$`,
    String.raw`pnpm-lock\.yaml$`,
    String.raw`${PATH_SEGMENT_START}vitest\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}vite\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}jest\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}playwright\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}eslint\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}prettier\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}postcss\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}tailwind\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}webpack\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}rollup\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}babel\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}next\.config\.[cm]?[jt]s$`,
    String.raw`${PATH_SEGMENT_START}svelte\.config\.[cm]?[jt]s$`,
    String.raw`tsconfig.*\.json$`,
    String.raw`\.eslintrc`,
    String.raw`\.prettierrc`,
    String.raw`\.gitignore$`,
    String.raw`\.env`,
    String.raw`Cargo\.toml$`,
    String.raw`Cargo\.lock$`,
    String.raw`go\.mod$`,
    String.raw`go\.sum$`,
    String.raw`pyproject\.toml$`,
    String.raw`pytest\.ini$`,
    String.raw`requirements.*\.txt$`,
    String.raw`setup\.py$`,
    String.raw`Gemfile$`,
    String.raw`mix\.exs$`,
    String.raw`[^\\/]+\.sln$`,
    String.raw`[^\\/]+\.csproj$`,
    String.raw`[^\\/]+\.fsproj$`,
    String.raw`pom\.xml$`,
    String.raw`build\.gradle$`,
    String.raw`build\.gradle\.kts$`,
    String.raw`phpunit\.xml$`,
    String.raw`phpunit\.xml\.dist$`,
    String.raw`Makefile$`,
    String.raw`Dockerfile`,
    String.raw`\.ya?ml$`,
    String.raw`\.toml$`,
    String.raw`\.ini$`,
    String.raw`\.cfg$`,
    String.raw`\.md$`,
  ].join("|"),
);

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

export function isConfigFile(filePath: string): boolean {
  return CONFIG_FILE_RE.test(filePath);
}

export function isProductionFile(filePath: string): boolean {
  return !isTestFile(filePath) && !isConfigFile(filePath);
}
