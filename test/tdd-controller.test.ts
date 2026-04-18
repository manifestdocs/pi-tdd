import type { ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/test-config.js", () => ({
  resolveTestConfig: vi.fn(),
}));

import { createTddController } from "../src/tdd-controller.js";
import { resolveTestConfig } from "../src/test-config.js";

const resolveTestConfigMock = vi.mocked(resolveTestConfig);

function createContext(cwd = "/repo"): {
  ctx: ExtensionContext;
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    setWidget: ReturnType<typeof vi.fn>;
  };
} {
  const ui = {
    notify: vi.fn(),
    setStatus: vi.fn(),
    setWidget: vi.fn(),
  };

  const ctx = {
    cwd,
    hasUI: true,
    ui,
  } as unknown as ExtensionContext;

  return { ctx, ui };
}

describe("createTddController", () => {
  beforeEach(() => {
    resolveTestConfigMock.mockReset();
  });

  it("describes specifying as behavior-first when enabling TDD", async () => {
    resolveTestConfigMock.mockResolvedValue({ command: "npm test", cwd: "/repo" });
    const controller = createTddController();
    const { ctx, ui } = createContext();

    const message = await controller.enable(ctx);

    expect(ui.notify).toHaveBeenCalledWith("TDD on — specify behavior in a test");
    expect(message).toContain("TDD enabled — SPECIFYING phase.");
    expect(message).toContain("Specify the next behavior in a test before changing production code.");
    expect(message).toContain("Test command: npm test");
  });

  it("blocks production edits with behavior-first specifying guidance", async () => {
    resolveTestConfigMock.mockResolvedValue({ command: "npm test", cwd: "/repo" });
    const controller = createTddController();
    const { ctx, ui } = createContext();

    await controller.enable(ctx);
    const mutation = controller.handleProductionWrite("src/math.ts", ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      "SPECIFYING: specify behavior in a test before editing production code",
      "warning",
    );
    expect(mutation).toEqual({
      block: true,
      reason: "TDD SPECIFYING phase: specify the next behavior in a test before changing production code",
    });
  });

  it("uses the same guidance for shell-based production writes", async () => {
    resolveTestConfigMock.mockResolvedValue({ command: "npm test", cwd: "/repo" });
    const controller = createTddController();
    const { ctx, ui } = createContext();

    await controller.enable(ctx);
    const mutation = controller.handleShellWriteWarning(
      {
        toolName: "bash",
        input: { command: "printf 'export const x = 1' > src/math.ts" },
        content: [],
      } as unknown as ToolResultEvent,
      ctx,
    );

    expect(ui.notify).toHaveBeenCalledWith("SPECIFYING: possible production write via shell", "warning");
    expect(mutation).toEqual({
      content: [
        {
          type: "text",
          text:
            "\n\n[TDD WARNING] This command appears to write to a production file during SPECIFYING." +
            " TDD best practice: specify the next behavior in a test before modifying production code." +
            " This is a warning only — the command was not blocked.",
        },
      ],
    });
  });
});
