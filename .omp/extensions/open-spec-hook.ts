// omp port of the .claude/settings.json hooks: same script, same record/flush split.
import { spawn } from "node:child_process";
import path from "node:path";

const SCRIPT = ["scripts", "open-spec-hook.mjs"];
const EDIT_PATH_RE = /^\[([^\]\r\n#]+)#[0-9A-Fa-f]{4}\]/gm;

function run(cwd: string, mode: "--record" | "--flush", payload: object): void {
	try {
		const child = spawn("node", [path.join(cwd, ...SCRIPT), mode], {
			cwd,
			env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
			stdio: ["pipe", "ignore", "ignore"],
		});
		child.on("error", () => {});
		child.stdin.end(JSON.stringify({ cwd, ...payload }));
	} catch {
		// never block the tool call
	}
}

function touchedPaths(toolName: string, input: Record<string, unknown>): string[] {
	if (toolName === "write" && typeof input.path === "string") return [input.path];
	if (toolName === "edit" && typeof input.input === "string") {
		return [...input.input.matchAll(EDIT_PATH_RE)].map(m => m[1].trim());
	}
	return [];
}

interface HookCtx {
	cwd: string;
}
interface ToolResultEvent {
	toolName: string;
	input?: Record<string, unknown>;
	isError?: boolean;
}
// Minimal local shape; the real ExtensionAPI type lives inside the omp package.
interface HookApi {
	on(event: "tool_result", handler: (event: ToolResultEvent, ctx: HookCtx) => Promise<void>): void;
	on(event: "agent_end", handler: (event: unknown, ctx: HookCtx) => Promise<void>): void;
}

export default function openSpecHook(pi: HookApi): void {
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;
		for (const filePath of touchedPaths(event.toolName, event.input ?? {})) {
			run(ctx.cwd, "--record", { tool_input: { file_path: filePath } });
		}
	});
	pi.on("agent_end", async (_event, ctx) => {
		run(ctx.cwd, "--flush", {});
	});
}
