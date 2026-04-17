import { type ExtensionAPI, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { createTddController } from "./tdd-controller.js";

export default function tddExtension(pi: ExtensionAPI) {
  const controller = createTddController();

  pi.registerCommand("tdd", {
    description: "Toggle TDD mode (specifying-implementing-refactoring)",
    handler: async (_args, ctx) => {
      if (controller.getPhase() === "off") await controller.enable(ctx);
      else controller.disable(ctx);
    },
  });

  pi.registerTool({
    name: "tdd_start",
    label: "TDD Start",
    description:
      "Enable TDD mode for feature or bug fix work." +
      " Call this before writing code when the task" +
      " involves new behavior or fixing a bug.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const msg = await controller.enable(ctx);
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  pi.registerTool({
    name: "tdd_done",
    label: "TDD Done",
    description: "End TDD mode. Call this when the current feature or bug fix is complete and all tests pass.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const msg = controller.disable(ctx);
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    let filePath: string | undefined;
    if (isToolCallEventType("write", event)) filePath = event.input.path;
    else if (isToolCallEventType("edit", event)) filePath = event.input.path;
    if (!filePath) return undefined;
    return controller.handleProductionWrite(filePath, ctx);
  });

  pi.on("tool_result", async (event, ctx) => controller.handleFileToolResult(event, ctx));
  pi.on("tool_result", async (event, ctx) => controller.handleShellWriteWarning(event, ctx));
  pi.on("tool_result", async (event, ctx) => controller.handleManualTestRun(event, ctx));
  pi.on("turn_start", async (_event, ctx) => controller.handleTurnStart(ctx));
  pi.on("before_agent_start", async (event) => ({ systemPrompt: controller.buildSystemPrompt(event.systemPrompt) }));
}
