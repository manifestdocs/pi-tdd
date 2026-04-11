/**
 * Pi TDD Extension
 *
 * Enforces specifying-implementing-refactoring sequencing when activated via /tdd.
 * Off by default. No configuration beyond a test command.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

type Phase = "off" | "specifying" | "implementing" | "refactoring";

interface TestResult {
	name: string;
	passed: boolean;
}

interface TestSummary {
	tests: TestResult[];
	passed: number;
	failed: number;
	duration?: string;
}

// -- Test output parsing ------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

function parseTestOutput(raw: string): TestSummary {
	const lines = raw.split("\n").map(stripAnsi);
	const tests: TestResult[] = [];

	for (const line of lines) {
		const t = line.trim();
		let m;

		// Jest/Vitest: ✓ name (Xms) or ✗ name
		if ((m = t.match(/^[✓✔√]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/))) {
			tests.push({ name: m[1], passed: true });
		} else if ((m = t.match(/^[✗✕×]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/))) {
			tests.push({ name: m[1], passed: false });
		}
		// Go: --- PASS: TestName (0.00s) / --- FAIL: TestName
		else if ((m = t.match(/^---\s+(PASS|FAIL):\s+(\S+)/))) {
			tests.push({ name: m[2], passed: m[1] === "PASS" });
		}
		// pytest: path::test_name PASSED/FAILED
		else if ((m = t.match(/^(\S+::\S+)\s+(PASSED|FAILED)/))) {
			tests.push({ name: m[1], passed: m[2] === "PASSED" });
		}
		// Cargo: test name ... ok/FAILED
		else if ((m = t.match(/^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED)/))) {
			tests.push({ name: m[1], passed: m[2] === "ok" });
		}
		// TAP: ok N - desc / not ok N - desc
		else if ((m = t.match(/^(not )?ok\s+\d+\s*-?\s*(.+)/))) {
			tests.push({ name: m[2].trim(), passed: !m[1] });
		}
	}

	// Summary counts: prefer parsed tests, fall back to regex on output
	const full = lines.join("\n");
	let passed = tests.filter((t) => t.passed).length;
	let failed = tests.filter((t) => !t.passed).length;

	if (tests.length === 0) {
		const pm = full.match(/(\d+)\s+pass(?:ed|ing)?/i);
		const fm = full.match(/(\d+)\s+fail(?:ed|ing|ures?)?/i);
		if (pm) passed = parseInt(pm[1]);
		if (fm) failed = parseInt(fm[1]);
	}

	// Duration
	let duration: string | undefined;
	const dm =
		full.match(/in\s+([\d.]+\s*m?s)/i) ||
		full.match(/Time:\s*([\d.]+\s*m?s)/i) ||
		full.match(/Duration\s+([\d.]+\s*m?s)/i);
	if (dm) duration = dm[1];

	return { tests, passed, failed, duration };
}

function formatDuration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// -- File classification ------------------------------------------------------

const TEST_FILE_RE = /\.test\.|\.spec\.|_test\.|_spec\.|\/__tests__\/|\/test\//;
const CONFIG_FILE_RE =
	/package\.json$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|tsconfig.*\.json$|\.eslintrc|\.prettierrc|\.gitignore$|\.env|Cargo\.toml$|Cargo\.lock$|go\.mod$|go\.sum$|pyproject\.toml$|requirements.*\.txt$|Makefile$|Dockerfile|\.ya?ml$|\.toml$|\.ini$|\.cfg$|\.md$/;

function isTestFile(filePath: string): boolean {
	return TEST_FILE_RE.test(filePath);
}

function isConfigFile(filePath: string): boolean {
	return CONFIG_FILE_RE.test(filePath);
}

async function inferTestCommand(cwd: string): Promise<string | undefined> {
	const exists = async (name: string) => {
		try {
			await fs.promises.access(path.join(cwd, name));
			return true;
		} catch {
			return false;
		}
	};

	if (await exists("package.json")) {
		try {
			const pkg = JSON.parse(await fs.promises.readFile(path.join(cwd, "package.json"), "utf-8"));
			if (pkg.scripts?.test) return "npm test";
		} catch {}
	}
	if (await exists("Cargo.toml")) return "cargo test";
	if (await exists("go.mod")) return "go test ./...";
	if (await exists("pytest.ini")) return "pytest";
	if (await exists("pyproject.toml")) return "pytest";

	return undefined;
}

// -- Extension ----------------------------------------------------------------

export default function tddExtension(pi: ExtensionAPI) {
	let phase: Phase = "off";
	let testCommand: string | undefined;
	let testFileWritten = false;
	let lastSummary: TestSummary | undefined;
	let cycleCount = 0;

	// -- Helpers --------------------------------------------------------------

	async function runTests(): Promise<{ passed: boolean; output: string; durationMs: number }> {
		if (!testCommand) return { passed: true, output: "No test command configured", durationMs: 0 };
		const [cmd, ...args] = testCommand.split(/\s+/);
		const start = Date.now();
		const { stdout, stderr, code } = await pi.exec(cmd, args);
		const durationMs = Date.now() - start;
		return { passed: code === 0, output: (stdout + "\n" + stderr).trim(), durationMs };
	}

	function setPhase(next: Phase, ctx: ExtensionContext) {
		if (next === "specifying" && phase === "refactoring") cycleCount++;
		phase = next;
		if (next === "specifying") testFileWritten = false;
		if (next === "off") {
			lastSummary = undefined;
			cycleCount = 0;
		}
		ctx.ui.setStatus("tdd", phase === "off" ? "" : `TDD: ${phase.toUpperCase()}`);
		updateWidget(ctx);
	}

	// -- HUD widget -----------------------------------------------------------

	const PHASE_COLORS: Record<string, "error" | "success" | "accent"> = {
		specifying: "error",
		implementing: "accent",
		refactoring: "success",
	};

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (phase === "off") {
			ctx.ui.setWidget("tdd", undefined);
			return;
		}

		// Capture state for the closure
		const snap = { phase, cycleCount, summary: lastSummary };

		ctx.ui.setWidget("tdd", (_tui, theme) => ({
			render(width: number): string[] {
				const lines: string[] = [];
				const maxName = width - 8;

				// Phase + cycle
				const phaseLabel = theme.bold(theme.fg(PHASE_COLORS[snap.phase] ?? "text", snap.phase.toUpperCase()));
				const cycleLabel = snap.cycleCount > 0 ? theme.fg("dim", ` cycle ${snap.cycleCount}`) : "";
				lines.push(`${theme.fg("muted", "TDD")} ${phaseLabel}${cycleLabel}`);

				if (!snap.summary) {
					lines.push(theme.fg("dim", "  Waiting for tests..."));
					return lines;
				}

				// Summary: N passed | N failed | duration
				const parts: string[] = [];
				if (snap.summary.passed > 0) parts.push(theme.fg("success", `${snap.summary.passed} passed`));
				if (snap.summary.failed > 0) parts.push(theme.fg("error", `${snap.summary.failed} failed`));
				if (snap.summary.duration) parts.push(theme.fg("dim", snap.summary.duration));
				if (parts.length > 0) lines.push("  " + parts.join(theme.fg("dim", " | ")));

				// Individual test lines
				const maxTests = 7;
				const shown = snap.summary.tests.slice(0, maxTests);
				for (const t of shown) {
					const icon = t.passed ? theme.fg("success", "\u2714") : theme.fg("error", "\u2717");
					const name = truncateToWidth(t.name, maxName);
					lines.push(`  ${icon} ${name}`);
				}
				if (snap.summary.tests.length > maxTests) {
					lines.push(theme.fg("dim", `  ... ${snap.summary.tests.length - maxTests} more`));
				}

				return lines;
			},
			invalidate() {},
		}));
	}

	function shouldRunTests(filePath: string): boolean {
		if (isConfigFile(filePath)) return false;
		switch (phase) {
			case "specifying":
				return isTestFile(filePath);
			case "implementing":
			case "refactoring":
				return true;
			default:
				return false;
		}
	}

	// -- /tdd command ---------------------------------------------------------

	pi.registerCommand("tdd", {
		description: "Toggle TDD mode (specifying-implementing-refactoring)",
		handler: async (_args, ctx) => {
			if (phase === "off") {
				testCommand = await inferTestCommand(ctx.cwd);
				if (!testCommand && ctx.hasUI) {
					testCommand = (await ctx.ui.input("Test command", "npm test")) || undefined;
				}
				if (!testCommand) {
					ctx.ui.notify("TDD requires a test command", "warning");
					return;
				}
				cycleCount = 1;
				lastSummary = undefined;
				setPhase("specifying", ctx);
				ctx.ui.notify("TDD on \u2014 write a failing test");
			} else {
				setPhase("off", ctx);
				ctx.ui.notify("TDD off");
			}
		},
	});

	// -- SPECIFYING phase: gate production code writes ------------------------

	pi.on("tool_call", async (event, ctx) => {
		if (phase !== "specifying") return undefined;
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const filePath = event.input.path as string;
		if (!filePath || isTestFile(filePath) || isConfigFile(filePath)) return undefined;

		if (ctx.hasUI) {
			ctx.ui.notify("SPECIFYING: write a failing test first", "warning");
		}
		return { block: true, reason: "TDD SPECIFYING phase: write a failing test before changing production code" };
	});

	// -- Auto-run tests after writes ------------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		if (phase === "off" || event.isError) return;
		if (event.toolName !== "write" && event.toolName !== "edit") return;

		const filePath = event.input.path as string;
		if (!filePath) return;

		if (isTestFile(filePath)) testFileWritten = true;
		if (!shouldRunTests(filePath)) return;

		// SPECIFYING requires a test file to have been written
		if (phase === "specifying" && !testFileWritten) return;

		const { passed, output, durationMs } = await runTests();

		// Parse and update HUD
		lastSummary = parseTestOutput(output);
		if (!lastSummary.duration) lastSummary.duration = formatDuration(durationMs);
		updateWidget(ctx);

		// Append test output to tool result so the agent sees it
		const label = `[TDD ${phase.toUpperCase()}] Tests ${passed ? "PASS" : "FAIL"}`;
		const appended = [...event.content, { type: "text" as const, text: `\n${label}:\n${output}` }];

		// State transitions
		if (phase === "specifying" && !passed) {
			setPhase("implementing", ctx);
		} else if (phase === "implementing" && passed) {
			setPhase("refactoring", ctx);
		}
		// REFACTORING + fail: agent is told via system prompt to revert

		return { content: appended };
	});

	// -- Detect manual test runs via bash -------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		if (phase === "off" || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!command || !testCommand) return;
		if (!command.includes(testCommand)) return;

		// Parse test output from bash result
		const bashOutput = event.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		lastSummary = parseTestOutput(bashOutput);

		// Use exit code from details if available
		const details = event.details as { code?: number } | undefined;
		const testPassed = details?.code !== undefined ? details.code === 0 : !event.isError;

		updateWidget(ctx);

		if (phase === "specifying" && testFileWritten && !testPassed) {
			setPhase("implementing", ctx);
		} else if (phase === "implementing" && testPassed) {
			setPhase("refactoring", ctx);
		}
	});

	// -- REFACTORING -> SPECIFYING on new user turn ---------------------------

	pi.on("turn_start", async (_event, ctx) => {
		if (phase === "refactoring") {
			setPhase("specifying", ctx);
		}
	});

	// -- System prompt injection ----------------------------------------------

	pi.on("before_agent_start", async (event) => {
		if (phase === "off") return undefined;

		const guidance: Record<string, string> = {
			specifying: "Write a failing test FIRST. Do not modify production code until a test exists and fails. Use standard test file naming (*.test.*, *.spec.*, *_test.*, *_spec.*, or files in __tests__/ or test/ directories).",
			implementing: "Write the MINIMAL production code to make the failing test pass. No extra functionality or refactoring yet.",
			refactoring: "Restructure code freely but keep all tests passing. No new behavior. If a change causes test failure, revert it immediately.",
		};

		const testOrg = [
			"TEST ORGANIZATION:",
			"- One test file per module or unit under test. Split when a file covers a distinct area of behavior.",
			"- Top-level group (describe/suite) names the unit. Nest context groups for different scenarios (e.g. 'when input is negative', 'with no arguments').",
			"- Each test describes the expected outcome, not the setup. Prefer 'returns 0 for empty list' over 'test empty list'.",
			"- Add to an existing test file when the new test covers the same unit. Create a new file when it covers a different one.",
			"- Test YOUR business logic, not library/framework behavior. If a dependency is already tested independently, don't re-prove it. Assert what your code does with the result, not that the library works.",
		].join("\n");

		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n[TDD MODE \u2014 ${phase.toUpperCase()} PHASE]\n${guidance[phase]}\nTest command: ${testCommand}\n\n${testOrg}`,
		};
	});
}
