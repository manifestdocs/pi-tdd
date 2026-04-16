import { describe, expect, test } from "vitest";
import { detectsShellWritePattern, extractRedirectTargets } from "../src/shell-detection.js";

describe("detectsShellWritePattern", () => {
  const positives = [
    "cat > src/main.ts",
    "cat >> src/main.ts",
    "cat src/template.ts > src/main.ts",
    "echo hello > src/app.py",
    "echo 'export default {}' >> src/index.ts",
    "tee src/main.rs",
    "tee -a src/main.rs",
    "sed -i 's/old/new/' src/main.go",
    "sed -i'' 's/old/new/' src/main.go",
    "printf '%s' content > src/lib.ts",
    "dd if=/dev/zero of=src/output.bin bs=1024 count=1",
    "cat <<EOF > src/main.ts",
    "cat <<'EOF' > src/main.ts",
  ];

  for (const cmd of positives) {
    test(`detects: ${cmd}`, () => {
      expect(detectsShellWritePattern(cmd)).toBe(true);
    });
  }

  const negatives = [
    "cat src/main.ts",
    "echo hello",
    "npm test",
    "cargo test",
    "grep -r pattern src/",
    "sed 's/old/new/' src/main.go",
    "ls -la src/",
    "git status",
  ];

  for (const cmd of negatives) {
    test(`ignores: ${cmd}`, () => {
      expect(detectsShellWritePattern(cmd)).toBe(false);
    });
  }
});

describe("extractRedirectTargets", () => {
  test("extracts single redirect target", () => {
    expect(extractRedirectTargets("echo x > src/main.ts")).toEqual(["src/main.ts"]);
  });

  test("extracts append redirect target", () => {
    expect(extractRedirectTargets("echo x >> src/main.ts")).toEqual(["src/main.ts"]);
  });

  test("extracts tee target", () => {
    expect(extractRedirectTargets("echo x | tee src/main.ts")).toEqual(["src/main.ts"]);
  });

  test("extracts tee -a target", () => {
    expect(extractRedirectTargets("echo x | tee -a src/main.ts")).toEqual(["src/main.ts"]);
  });

  test("ignores /dev/null redirect", () => {
    expect(extractRedirectTargets("command > /dev/null 2>&1")).toEqual([]);
  });

  test("extracts multiple redirect targets", () => {
    const targets = extractRedirectTargets("cat file > out1.ts >> out2.ts");
    expect(targets).toContain("out1.ts");
    expect(targets).toContain("out2.ts");
  });

  test("returns empty for no redirects", () => {
    expect(extractRedirectTargets("npm test")).toEqual([]);
  });
});
