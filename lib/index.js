import { copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { TypertLookupFailure, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/index.ts
/**
* dsh-attachments 宿主端:fileStash 落盘网关 + 发送时注入。
*
* 附件哲学:零类型拒绝。图片走浏览器端原生附件管线(不经过本网关);
* 其余一切文件由本网关落盘到会话工作区 `<cwd>/.dsh/uploads/`。
*
* 关键设计:**草稿不写引用文本**。落盘文件按会话暂存(pending),浏览器端
* 只显示卡片;用户下一条消息进入模型请求时,本插件在 `agent/pre-step`
* 波形里把附件清单作为一条 `plugin` 来源的用户消息折进批次(紧跟用户
* 消息之后)——与官方 dsh-agent-instructions 的注入模式同构,模型可见即
* 落日志,回放安全。浏览器端的卡片以宿主 pending 为真相源(listStash),
* 注入(消费)后卡片自动消失。
*
* 路径安全:stash 只往 `<cwd>/.dsh/uploads/` 下写,文件名做白名单化清洗
* (时间戳前缀防撞名);removeStash 只接受该目录下的相对路径,resolve 后
* 再做前缀校验。
*
* 第三方双副本场景下 SRC 发现失明,因此把弱(src-json)清单注册进宿主
* typert registry。Gateway 按参数名生成 wire 字段,公开方法保持简单
* 标识符参数;不使用 @Remote 装饰器(双副本下无效,且 tsdown 产物保留
* 装饰器语法会让 Node 导入报错)。
*/
/** 单个文件经 RPC 落盘的解码后字节上限(JSON wire 传输的现实约束)。 */
const MAX_STASH_BYTES = 33554432;
/** 工作区内的落盘目录(相对 cwd)。 */
const UPLOADS_DIR = ".dsh/uploads";
/** 每会话最多暂存的附件数(误操作保险)。 */
const MAX_PENDING_PER_SESSION = 30;
/** 全局附件索引:时间戳文件名 → 落盘绝对路径(跨项目引用迁移用)。 */
function indexPath() {
	const home = process.env.DSH_HOME !== void 0 && process.env.DSH_HOME !== "" ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
	return join(home, "attachments-index.json");
}
function loadIndex() {
	try {
		const parsed = JSON.parse(readFileSync(indexPath(), "utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}
function recordIndex(fileName, absolute) {
	const index = loadIndex();
	index[fileName] = absolute;
	const keys = Object.keys(index);
	const trimmed = keys.length > 2e3 ? Object.fromEntries(keys.slice(keys.length - 2e3).map((key) => [key, index[key]])) : index;
	try {
		writeFileSync(indexPath(), `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
	} catch {}
}
/**
* 构造一个携带结构化载荷的 RPC 失败。经网关 rpcFailure 对
* TypertLookupFailure 的原样透传,failure 对象即客户端的 result.error。
* @param code - 稳定 dot-code。
* @param message - 兜底中文文案。
* @param params - 可选 `{name}` 模板参数。
* @returns 待抛出的失败。
*/
function failure(code, message, params) {
	return new TypertLookupFailure({
		code,
		...params === void 0 ? {} : { params },
		level: "error",
		message
	});
}
/** 校验并解析工作区目录:必须是存在的绝对路径目录。 */
function checkCwd(cwd) {
	if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0")) throw failure("cwd.err.invalid", "attachments: cwd 必须是非空字符串");
	if (!isAbsolute(cwd)) throw failure("cwd.err.notAbsolute", `attachments: cwd 必须是绝对路径,收到 ${JSON.stringify(cwd)}`, { value: JSON.stringify(cwd) });
	let stats;
	try {
		stats = statSync(cwd);
	} catch {
		throw failure("cwd.err.unreachable", `attachments: 工作区目录不可访问: ${cwd}`, { cwd });
	}
	if (!stats.isDirectory()) throw failure("cwd.err.notDir", `attachments: cwd 不是目录: ${cwd}`, { cwd });
	return resolve(cwd);
}
function checkSessionId(sessionId) {
	if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 200) throw failure("session.err.invalid", "attachments: sessionId 必须是非空字符串");
	return sessionId;
}
/**
* 把用户文件名清洗为安全的落盘名:仅保留字母数字、点、连字符、下划线与
* 常见 Unicode 文字,其余替换为 `_`;去掉路径分隔与前导点。
*/
function sanitizeName(name) {
	const cleaned = (name.split(/[\\/]/).pop() ?? "").replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "");
	return cleaned.length === 0 ? "file" : cleaned.slice(0, 120);
}
/** 时间戳前缀(yyMMdd-HHmmss)。 */
function stampPrefix() {
	const now = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
/** 人类可读的大小。 */
function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/**
* 生成注入消息的正文:附件清单 + 一句话使用说明。
* @param files - 本轮随消息带入的附件。
* @returns 注入的纯文本。
*/
function buildAttachmentNote(files) {
	return `${files.map((file) => `📎 ${file.name}(${formatSize(file.size)}) → ${file.relPath}`).join("\n")}\n(附件已存入工作区,用文件工具按相对路径直接读取)`;
}
/**
* 把某会话的暂存附件折进一次 pre-step 决策(纯函数,便于测试)。
* 只在「本步有已认领的用户消息进入」时注入;注入位置紧跟最后一条已认领
* 消息(直发提示在前,运行时上下文在后——与 agent-instructions 同位)。
* @param decision - 下游波形已产出的决策。
* @param payload - pre-step 载荷(认领批次 + agent)。
* @param files - 该会话暂存的附件。
* @returns 注入后的决策与是否消费了附件。
*/
function foldPendingAttachments(decision, payload, files) {
	if (decision.kind !== "enter" || !Array.isArray(decision.messages)) return {
		decision,
		consumed: false
	};
	const claimed = payload.messages;
	if (!Array.isArray(claimed) || claimed.length === 0) return {
		decision,
		consumed: false
	};
	if (files.length === 0) return {
		decision,
		consumed: false
	};
	const note = createUserMessage({
		content: [{
			type: "text",
			text: buildAttachmentNote(files)
		}],
		source: { kind: "user" }
	});
	const firstClaimed = decision.messages.findIndex((message) => claimed.includes(message));
	const messages = decision.messages.toSpliced(Math.max(firstClaimed, 0), 0, note);
	return {
		decision: {
			...decision,
			kind: "enter",
			messages
		},
		consumed: true
	};
}
function jsonParameter(name) {
	return {
		name,
		wire: name,
		source: "json",
		codec: { mode: "src-json" }
	};
}
function invocation(method, parameters) {
	return {
		id: `dsh-attachments#fileStash/${method}`,
		service: "fileStash",
		namespace: "fileStash",
		method,
		invocation: { kind: "direct" },
		parameters: parameters.map(jsonParameter),
		result: { mode: "src-json" }
	};
}
const TYPERT_MANIFEST = {
	package: "dsh-attachments",
	face: "host",
	schemas: [],
	model: {
		services: [],
		events: [],
		objects: []
	},
	invocations: [
		invocation("stashFile", [
			"cwd",
			"sessionId",
			"name",
			"dataBase64"
		]),
		invocation("removeStash", [
			"cwd",
			"sessionId",
			"relPath"
		]),
		invocation("restageFile", [
			"cwd",
			"sessionId",
			"relPath"
		]),
		invocation("clearStash", ["cwd", "sessionId"]),
		invocation("readStash", ["cwd", "relPath"]),
		invocation("listStash", ["sessionId"])
	]
};
/**
* fileStash 网关服务:非图片附件的工作区落盘、按会话暂存与发送时注入。
* @param ctx - 宿主 Cordis 上下文。
*/
var AttachmentsGateway = class extends TypertRemoteService {
	/** 每会话暂存的附件(内存态;进程重启后卡片消失,文件仍在磁盘)。 */
	pending = /* @__PURE__ */ new Map();
	/** 注册 'fileStash' 服务键(官方已占用 'attachments');typert registry 就绪后补登记弱清单;挂 pre-step 注入。 */
	constructor(ctx) {
		super(ctx, "fileStash");
		ctx.inject(["typert"], (typertCtx) => typertCtx.typert.register(TYPERT_MANIFEST));
		ctx.on("agent/pre-step", async (payload, next) => {
			const decision = await next();
			const sessionId = payload.agent?.session?.id;
			if (typeof sessionId !== "string") return decision;
			const files = this.pending.get(sessionId);
			if (files === void 0 || files.length === 0) return decision;
			const { decision: folded, consumed } = foldPendingAttachments(decision, payload, files);
			if (consumed) this.pending.delete(sessionId);
			return folded;
		});
	}
	/** 把一个文件落盘到 `<cwd>/.dsh/uploads/` 并加入会话暂存。 */
	stashFile(cwd, sessionId, name, dataBase64) {
		const resolvedCwd = checkCwd(cwd);
		const session = checkSessionId(sessionId);
		if (typeof dataBase64 !== "string") throw failure("stash.err.data", "attachments: dataBase64 必须是字符串");
		const staged = this.pending.get(session) ?? [];
		if (staged.length >= MAX_PENDING_PER_SESSION) throw failure("stash.err.tooMany", `attachments: 一条消息最多暂存 ${MAX_PENDING_PER_SESSION} 个附件`, { max: MAX_PENDING_PER_SESSION });
		const bytes = Buffer.from(dataBase64, "base64");
		if (bytes.length > 33554432) throw failure("stash.err.tooLarge", `attachments: 文件超过 ${MAX_STASH_BYTES / 1024 / 1024}MB 传输上限;更大的文件请直接放进项目目录后在消息里写路径`, { max: MAX_STASH_BYTES / 1024 / 1024 });
		const dir = join(resolvedCwd, UPLOADS_DIR);
		mkdirSync(dir, { recursive: true });
		const safe = sanitizeName(typeof name === "string" ? name : "file");
		let fileName = `${stampPrefix()}-${safe}`;
		let target = join(dir, fileName);
		if (statOf(target) !== void 0) {
			fileName = `${stampPrefix()}-${String(Date.now() % 1e3)}-${safe}`;
			target = join(dir, fileName);
		}
		writeFileSync(target, bytes);
		recordIndex(fileName, target);
		const file = {
			relPath: `${UPLOADS_DIR}/${fileName}`,
			name: safe,
			size: bytes.length
		};
		this.pending.set(session, [...staged, file]);
		return {
			relPath: file.relPath,
			size: file.size
		};
	}
	/** 撤回一个暂存附件(卡片 ✕):移出暂存并删除落盘文件。 */
	removeStash(cwd, sessionId, relPath) {
		const resolvedCwd = checkCwd(cwd);
		const session = checkSessionId(sessionId);
		if (typeof relPath !== "string" || !relPath.startsWith(`.dsh/uploads/`) || relPath.includes("..") || relPath.includes("\0")) throw failure("remove.err.badPath", `attachments: 不支持的撤回路径: ${JSON.stringify(relPath)}`, { path: relPath });
		const staged = this.pending.get(session);
		if (staged !== void 0) {
			const next = staged.filter((file) => file.relPath !== relPath);
			if (next.length === 0) this.pending.delete(session);
			else this.pending.set(session, next);
		}
		const target = resolve(resolvedCwd, relPath);
		const uploadsRoot = join(resolvedCwd, UPLOADS_DIR);
		if (!target.startsWith(uploadsRoot + sep)) throw failure("stash.err.escape", "attachments: 解析后的路径越出了 uploads 目录");
		if (statOf(target) === void 0) return { removed: false };
		unlinkSync(target);
		return { removed: true };
	}
	/** 把一个已落盘的 uploads 文件重新加入会话暂存(粘贴引用行再物化)。 */
	restageFile(cwd, sessionId, relPath) {
		const resolvedCwd = checkCwd(cwd);
		const session = checkSessionId(sessionId);
		if (typeof relPath !== "string" || !relPath.startsWith(`.dsh/uploads/`) || relPath.includes("..") || relPath.includes("\0")) throw failure("restage.err.badPath", `attachments: 不支持的引用路径: ${JSON.stringify(relPath)}`, { path: relPath });
		const target = resolve(resolvedCwd, relPath);
		if (!target.startsWith(join(resolvedCwd, ".dsh/uploads") + sep)) throw failure("stash.err.escape", "attachments: 解析后的路径越出了 uploads 目录");
		let stats = statOf(target);
		if (stats === void 0) {
			const fileName = relPath.slice(13);
			const source = loadIndex()[fileName];
			const sourceStats = source === void 0 ? void 0 : statOf(source);
			if (source === void 0 || sourceStats === void 0) throw failure("restage.err.missing", `attachments: 引用的文件不存在(本地与全局索引均未命中): ${relPath}`, { path: relPath });
			mkdirSync(join(resolvedCwd, UPLOADS_DIR), { recursive: true });
			copyFileSync(source, target);
			recordIndex(fileName, target);
			stats = statOf(target);
			if (stats === void 0) throw failure("restage.err.migrate", `attachments: 迁移后无法读取文件: ${relPath}`, { path: relPath });
		}
		const staged = this.pending.get(session) ?? [];
		if (staged.some((file) => file.relPath === relPath)) return {
			relPath,
			size: stats.size
		};
		if (staged.length >= MAX_PENDING_PER_SESSION) throw failure("stash.err.tooMany", `attachments: 一条消息最多暂存 ${MAX_PENDING_PER_SESSION} 个附件`, { max: MAX_PENDING_PER_SESSION });
		const name = relPath.slice(13).replace(/^\d{6}-\d{6}(?:-\d+)?-/u, "");
		this.pending.set(session, [...staged, {
			relPath,
			name,
			size: stats.size
		}]);
		return {
			relPath,
			size: stats.size
		};
	}
	/** 清空某会话的暂存并删除未发送的落盘文件。仅供用户显式「全部清除」
	* 类动作调用;绝不在页面加载/挂载时触发——多端同会话时,一端加载不能
	* 销毁另一端的待发送附件。 */
	clearStash(cwd, sessionId) {
		const resolvedCwd = checkCwd(cwd);
		const session = checkSessionId(sessionId);
		const staged = this.pending.get(session) ?? [];
		let removed = false;
		for (const file of staged) {
			const target = resolve(resolvedCwd, file.relPath);
			if (!target.startsWith(join(resolvedCwd, ".dsh/uploads") + sep)) continue;
			if (statOf(target) !== void 0) try {
				unlinkSync(target);
				removed = true;
			} catch {}
		}
		this.pending.delete(session);
		return { removed };
	}
	/** 读回一个 uploads 文件的字节(预览用;超 20MB 拒绝,防大文件拖爆页面)。 */
	readStash(cwd, relPath) {
		const resolvedCwd = checkCwd(cwd);
		if (typeof relPath !== "string" || !relPath.startsWith(`.dsh/uploads/`) || relPath.includes("..") || relPath.includes("\0")) throw failure("read.err.badPath", `attachments: 不支持的预览路径: ${JSON.stringify(relPath)}`, { path: relPath });
		const target = resolve(resolvedCwd, relPath);
		if (!target.startsWith(join(resolvedCwd, ".dsh/uploads") + sep)) throw failure("stash.err.escape", "attachments: 解析后的路径越出了 uploads 目录");
		const stats = statOf(target);
		if (stats === void 0) throw failure("read.err.missing", `attachments: 文件不存在: ${relPath}`, { path: relPath });
		if (stats.size > 20971520) throw failure("read.err.tooLarge", "attachments: 文件超过 20MB 预览上限,请用系统应用打开", { max: 20 });
		return {
			dataBase64: readFileSync(target).toString("base64"),
			size: stats.size
		};
	}
	/** 某会话当前暂存(尚未注入)的附件清单——浏览器卡片的真相源。 */
	listStash(sessionId) {
		const session = checkSessionId(sessionId);
		return { files: this.pending.get(session) ?? [] };
	}
};
function statOf(target) {
	try {
		const stats = statSync(target);
		return stats.isFile() ? { size: stats.size } : void 0;
	} catch {
		return;
	}
}
//#endregion
export { AttachmentsGateway, AttachmentsGateway as default, MAX_STASH_BYTES, UPLOADS_DIR, buildAttachmentNote, foldPendingAttachments };
