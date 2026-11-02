window.__ModuleLoader__.load({
	id: "@local/qqbot-skillpack",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const CURRENT_VERSION = '1.17.0';

		const API = "/qqbot-skillpack/api/v16";

		const S = {
			wrap: { width: "100%", maxWidth: 860, color: "#1f2329", padding: "4px 0" },
			h2: { margin: "18px 0 8px", fontSize: 17, fontWeight: 600, color: "#111827" },
			p: { margin: "0 0 14px", fontSize: 13, lineHeight: 1.6, color: "#6b7280" },
			card: { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: "14px 16px", marginBottom: 12 },
			row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 },
			label: { fontSize: 13, color: "#374151", minWidth: 120 },
			input: { border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 9px", fontSize: 13, color: "#111827", minWidth: 220, background: "#fff" },
			select: { border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 9px", fontSize: 13, color: "#111827", background: "#fff" },
			btn: { background: "#fff", border: "1px solid #d1d5db", color: "#374151", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" },
			btnPrimary: { background: "#2563eb", color: "#fff", border: 0, borderRadius: 6, padding: "7px 13px", fontSize: 13, cursor: "pointer" },
			btnDanger: { background: "#fff", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" },
			table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
			th: { textAlign: "left", padding: "6px 8px", color: "#6b7280", fontWeight: 500, borderBottom: "1px solid #e5e7eb" },
			td: { padding: "6px 8px", borderBottom: "1px solid #f3f4f6", color: "#374151" },
			banner: { background: "#eef2ff", color: "#1e3a8a", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 },
			ok: { background: "#f0fdf4", color: "#166534", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 },
			err: { background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 },
		};

		const post = (payload) => fetch(API, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		}).then((r) => r.json());

		function Field({ label, value, onCommit, type }) {
			return h("div", { style: S.row },
				h("span", { style: S.label }, label),
				h("input", {
					type: type || "text",
					value: value === undefined || value === null ? "" : String(value),
					style: S.input,
					onChange: (e) => onCommit(e.target.value, false),
					onBlur: (e) => onCommit(e.target.value, true),
				}),
			);
		}

		function QQBotSettingsPage(props) {
			const [state, setState] = React.useState({ bot: {}, autoAdapt: { enabled: false }, groups: [] });
			const [msg, setMsg] = React.useState("");
			const [failed, setFailed] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [discovered, setDiscovered] = React.useState([]);
			const [dirty, setDirty] = React.useState(false);
			const [step, setStep] = React.useState(1);
			const [selected, setSelected] = React.useState([]);
			const [epInput, setEpInput] = React.useState("");
			const [tokenInput, setTokenInput] = React.useState("");
			const [promptText, setPromptText] = React.useState("");
			const [updateInfo, setUpdateInfo] = React.useState(null);
			const [updateBusy, setUpdateBusy] = React.useState(false);

			const reload = async () => {
				try {
					const r = await post({ action: "state" });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "读取失败");
					setState(r.state);
					setDirty(false);
					if (r.state && r.state.bot && r.state.bot.selfQQ && Array.isArray(r.state.groups) && r.state.groups.length > 0) {
						setStep(0);
					}
					return r.state;
				} catch (e) {
					setMsg("读取配置失败：" + String((e && e.message) || e));
					setFailed(true);
					return null;
				}
			};

			const loadGroups = async (stateArg) => {
				const cur = stateArg || state;
				try {
					const r = await post({ action: "groups", path: (cur.bot && cur.bot.workspacePath) || "", endpoint: (cur.bot && cur.bot.httpEndpoint) || "" });
					if (r && r.ok === true) setDiscovered(Array.isArray(r.groups) ? r.groups : []);
				} catch (e) {
					setMsg("群聊发现失败：" + String((e && e.message) || e));
				}
			};

			const checkUpdate = async () => {
				setUpdateBusy(true);
				try {
					const r = await post({ action: "check_update" });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "检查失败");
					setUpdateInfo(r);
				} catch (e) {
					setMsg("检查更新失败：" + String((e && e.message) || e));
				} finally {
					setUpdateBusy(false);
				}
			};

			React.useEffect(() => { reload().then((s) => { if (s) loadGroups(s); }); checkUpdate(); }, []);

			const bot = state.bot || {};
			const remote = state.remote || {};
			const groups = Array.isArray(state.groups) ? state.groups : [];
			const autoAdapt = !!(state.autoAdapt && state.autoAdapt.enabled);

			const setPath = (path, value, commit) => {
				setState((prev) => {
					const next = JSON.parse(JSON.stringify(prev));
					let cur = next;
					for (let i = 0; i < path.length - 1; i += 1) {
						const k = path[i];
						if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
						cur = cur[k];
					}
					cur[path[path.length - 1]] = value;
					return next;
				});
				if (commit) {
					post({ action: "set", path, value }).then((r) => {
						if (!r || r.ok !== true) { setMsg("保存失败：" + ((r && r.error) || "unknown")); setFailed(true); return; }
						if (r.state) setState(r.state);
						setFailed(false);
					}).catch((e) => { setMsg("保存失败：" + String((e && e.message) || e)); setFailed(true); });
				}
			};

			const bindAndDetect = async () => {
				if (busy) return;
				try {
					setBusy(true);
					setMsg("正在选择工作区…");
					setFailed(false);
					const dir = props.pickDirectory ? await props.pickDirectory() : null;
					if (!dir) { setMsg("已取消选择"); return; }
					setMsg("正在识别 " + dir + " …");
					const r = await post({ action: "bind", path: dir, endpoint: bot.httpEndpoint || "" });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "识别失败");
					const f = r.fields || {};
					const bits = ["类型 " + (r.type || "unknown")];
					if (f.name) bits.push("昵称 " + f.name);
					if (f.selfQQ) bits.push("QQ " + f.selfQQ);
					if (f.httpEndpoint) bits.push("端点 " + f.httpEndpoint);
					if (Array.isArray(f.groupIds) && f.groupIds.length) bits.push("识别到 " + f.groupIds.length + " 个群");
					bits.push(r.persisted ? "已保存" : "未持久化");
					const notes = Array.isArray(r.notes) && r.notes.length ? "｜" + r.notes.join("；") : "";
					const ac = r.autoConnect;
					if (ac && ac.ok) {
						setMsg("✅ 已自动绑定：" + (ac.login.name || f.name || "(未命名)") + " · QQ " + (ac.login.selfQQ || f.selfQQ || "?") + " · 群 " + (ac.groups || []).length + " 个 · 已保存");
					} else {
						setMsg("✅ " + bits.join(" · ") + notes);
					}
					await reload().then((s) => { if (s) loadGroups(s); });
				} catch (e) {
					setMsg("识别失败：" + String((e && e.message) || e));
					setFailed(true);
				} finally {
					setBusy(false);
				}
			};

			const connectOneBot = async (ep, tk) => {
				if (busy) return false;
				const endpoint = ep !== undefined ? ep : (bot.httpEndpoint || "");
				const token = tk !== undefined ? tk : (bot.token || "");
				setBusy(true);
				setMsg("正在连接 OneBot…");
				setFailed(false);
				try {
					const r = await post({ action: "onebot", endpoint, token });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "连接失败");
					if (r.state) setState(r.state);
					setDiscovered(Array.isArray(r.groups) ? r.groups : []);
					setSelected((r.groups || []).map((g) => g.id));
					const nm = (r.login && r.login.name) || "";
					const qq = (r.login && r.login.selfQQ) || 0;
					setMsg("✅ 已连接 OneBot：" + (nm || "(无名)") + " · QQ " + (qq || "?") + " · 群 " + (r.groups || []).length + " 个" + (r.persisted ? " · 已保存" : ""));
					return true;
				} catch (e) {
					setMsg("连接失败：" + String((e && e.message) || e));
					setFailed(true);
					return false;
				} finally {
					setBusy(false);
				}
			};

			const bindFromPrompt = async () => {
				if (!promptText.trim()) { setMsg("请先输入绑定提示词"); setFailed(true); return; }
				if (busy) return;
				setBusy(true);
				setMsg("正在按提示词绑定…");
				setFailed(false);
				try {
					const r = await post({ action: "bind_prompt", prompt: promptText });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "绑定失败");
					if (r.state) setState(r.state);
					setDiscovered(Array.isArray(r.groups) ? r.groups : []);
					setSelected((r.groups || []).map((g) => g.id));
					const nm = (r.login && r.login.name) || "";
					const qq = (r.login && r.login.selfQQ) || 0;
					setMsg("✅ 已自动绑定：" + (nm || "(无名)") + " · QQ " + (qq || "?") + " · 群 " + (r.groups || []).length + " 个 · 新加入 " + ((r.added || []).length) + (r.persisted ? " · 已保存" : ""));
					setStep(0);
					setDirty(false);
				} catch (e) {
					setMsg("绑定失败：" + String((e && e.message) || e));
					setFailed(true);
				} finally {
					setBusy(false);
				}
			};

			const finishWizard = async () => {
				try {
					const additions = discovered
						.filter((g) => selected.includes(g.id) && !groups.some((x) => String(x.groupId) === String(g.id)))
						.map((g) => ({ groupId: String(g.id), mode: "at", probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ["闭嘴"] }));
					const next = groups.concat(additions);
					const r = await post({ action: "set", path: ["groups"], value: next });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "保存失败");
					if (r.state) setState(r.state);
					setDirty(false);
					setStep(0);
					setMsg("✅ 绑定完成，已加入 " + additions.length + " 个群，可在下方调整每个群的参数");
				} catch (e) {
					setMsg("保存失败：" + String((e && e.message) || e));
					setFailed(true);
				}
			};

			const addGroup = () => { setPath(["groups"], groups.concat([{ groupId: "", mode: "at", probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ["闭嘴"] }]), false); setDirty(true); };
			const removeGroup = (index) => { setPath(["groups"], groups.filter((_, i) => i !== index), false); setDirty(true); };
			const addDetectedGroup = (g) => {
				if (groups.some((x) => String(x.groupId) === String(g.id))) return;
				setPath(["groups"], groups.concat([{ groupId: String(g.id), mode: "at", probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ["闭嘴"] }]), false);
				setDirty(true);
			};
			const saveGroups = async () => {
				try {
					const r = await post({ action: "set", path: ["groups"], value: groups });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "保存失败");
					if (r.state) setState(r.state);
					setDirty(false);
					const sync = r.sync;
					let text = "✅ 群设置已保存";
					if (sync) {
						if (sync.ok) text += " · 已同步到" + (sync.mode === "local" ? "本机 AstrBot" : "服务器") + "（" + (sync.groups || 0) + " 个群）";
						else { text += " · 同步失败：" + (sync.error || "未知错误"); setFailed(true); }
					}
					setMsg(text);
					if (!sync || sync.ok) setFailed(false);
				} catch (e) {
					setMsg("保存失败：" + String((e && e.message) || e));
					setFailed(true);
				}
			};
			const applyRemote = async () => {
				if (busy) return;
				setBusy(true);
				setMsg("正在应用到服务器…");
				setFailed(false);
				try {
					const saved = await post({ action: "set", path: ["groups"], value: groups });
					if (!saved || saved.ok !== true) throw new Error((saved && saved.error) || "保存失败");
					setDirty(false);
					const r = await post({ action: "apply_remote" });
					if (!r || r.ok !== true) throw new Error((r && r.error) || "同步失败");
					setMsg("✅ 已同步到" + (r.mode === "local" ? "本机 AstrBot" : "服务器") + "（" + (r.groups || 0) + " 个群）" + (r.target ? " · " + r.target : ""));
				} catch (e) {
					setMsg("应用失败：" + String((e && e.message) || e));
					setFailed(true);
				} finally {
					setBusy(false);
				}
			};

			const qqShow = Number(bot.selfQQ) || 0;
			const nameShow = bot.name || "";

			return h("div", { style: S.wrap },
				h("div", { style: S.banner }, "QQBot 技能包 · 机器人属性与固定群触发方式"),

				h("h2", { style: S.h2 }, "一句话绑定"),
				h("div", { style: S.card },
					h("textarea", {
						value: promptText,
						onChange: (e) => setPromptText(e.target.value),
						rows: 3,
						placeholder: "例：绑定我的烟猫机器人，把所有群加进来（插件会自动找工作区里的连接信息）",
						style: { ...S.input, width: "100%", minHeight: 64, boxSizing: "border-box", resize: "vertical" },
					}),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10, marginTop: 8 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: bindFromPrompt, disabled: busy }, busy ? "绑定中…" : "自动绑定"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "只说“绑定我的机器人”即可：会复用已保存的连接信息，或从工作区文档/配置里找端点"),
					),
					msg ? h("div", { style: failed ? S.err : S.ok }, msg) : null,
				),

				h("h2", { style: S.h2 }, "版本检查"),
				h("div", { style: S.card },
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10, alignItems: "center" } },
						h("button", { type: "button", style: S.btnPrimary, onClick: checkUpdate, disabled: updateBusy }, updateBusy ? "检查中…" : "检查更新"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "当前版本 " + CURRENT_VERSION),
					),
					updateInfo ? h("div", { style: { marginTop: 8 } },
						updateInfo.ok ? (updateInfo.updateAvailable
							? h("div", { style: { background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px" } },
								h("p", { style: { margin: "0 0 6px", fontSize: 13, color: "#92400e" } }, "发现新版本 " + updateInfo.latestVersion + "（当前 " + updateInfo.currentVersion + "）"),
								h("a", { href: updateInfo.downloadUrl, target: "_blank", rel: "noopener noreferrer", style: { color: "#2563eb", textDecoration: "none" } }, "🔗 前往 GitHub 下载更新"),
								updateInfo.changelog ? h("div", { style: { marginTop: 6, fontSize: 12, color: "#6b7280", whiteSpace: "pre-wrap" } }, updateInfo.changelog) : null,
							) : h("div", { style: { color: "#16a34a", fontSize: 13 } }, "✅ 已是最新版本（" + updateInfo.currentVersion + "）")
						) : null,
					) : null,
				),

				step > 0 ? h("h2", { style: S.h2 }, "快速绑定（" + step + "/4）") : null,
				step === 1 ? h("div", { style: S.card },
					h("p", { style: S.p }, "先在 NapCat 开启 OneBot v11 的 HTTP 服务："),
					h("ol", { style: { margin: "0 0 12px 18px", padding: 0, fontSize: 13, color: "#374151", lineHeight: 1.9 } },
						h("li", null, "打开 NapCat WebUI（通常 http://127.0.0.1:6099）"),
						h("li", null, "进入「网络配置」→ 新建「HTTP 服务器」"),
						h("li", null, "地址 127.0.0.1，端口建议 3000，token 可留空或自定义"),
						h("li", null, "保存并启用"),
					),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: () => { setEpInput(bot.httpEndpoint || ""); setTokenInput(bot.token || ""); setStep(2); } }, "已开启，下一步"),
						h("button", { type: "button", style: S.btn, onClick: () => setStep(0) }, "跳过引导"),
					),
				) : null,
				step === 2 ? h("div", { style: S.card },
					h(Field, { label: "OneBot HTTP 端点", value: epInput, onCommit: (v) => setEpInput(v) }),
					h(Field, { label: "访问 Token", value: tokenInput, type: "password", onCommit: (v) => setTokenInput(v) }),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, disabled: busy, onClick: async () => { const ok = await connectOneBot(epInput, tokenInput); if (ok) setStep(3); } }, busy ? "连接中…" : "测试并连接"),
						h("button", { type: "button", style: S.btn, onClick: () => setStep(1) }, "上一步"),
					),
					msg ? h("div", { style: failed ? S.err : S.ok }, msg) : null,
				) : null,
				step === 3 ? h("div", { style: S.card },
					qqShow > 0 ? h("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } },
						h("img", { src: "https://q1.qlogo.cn/g?b=qq&nk=" + qqShow + "&s=100", width: 56, height: 56, alt: "avatar", style: { borderRadius: "50%", border: "1px solid #e5e7eb", objectFit: "cover" } }),
						h("div", null,
							h("div", { style: { fontSize: 15, fontWeight: 600, color: "#111827" } }, nameShow || "(未命名)"),
							h("div", { style: { fontSize: 12.5, color: "#6b7280" } }, "QQ " + qqShow + " · 共 " + discovered.length + " 个群"),
						),
					) : h("p", { style: S.p }, "已连接，但没有读取到账号信息。"),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: () => setStep(4) }, "下一步：选择群聊"),
						h("button", { type: "button", style: S.btn, onClick: () => setStep(2) }, "重新连接"),
					),
				) : null,
				step === 4 ? h("div", { style: S.card },
					h("p", { style: S.p }, "勾选要交给插件管理的群（默认「必须 @」触发，完成后可在下方逐个调参数）："),
					discovered.length === 0 ? h("p", { style: S.p }, "没有读取到群，请先回到上一步完成连接。") :
						h("div", { style: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflow: "auto", marginBottom: 12 } },
							discovered.map((g) => h("label", { key: g.id, style: { display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0" } },
								h("input", {
									type: "checkbox",
									checked: selected.includes(g.id),
									onChange: (e) => setSelected((prev) => (e.target.checked ? prev.concat([g.id]) : prev.filter((x) => x !== g.id))),
								}),
								(g.name ? g.name + " · " : "") + g.id,
							)),
						),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: finishWizard }, "完成绑定"),
						h("button", { type: "button", style: S.btn, onClick: () => setSelected(discovered.map((g) => g.id)) }, "全选"),
						h("button", { type: "button", style: S.btn, onClick: () => setSelected([]) }, "清空"),
						h("button", { type: "button", style: S.btn, onClick: () => setStep(3) }, "上一步"),
					),
				) : null,
				step === 0 ? h("div", { style: { ...S.row, justifyContent: "flex-start", marginBottom: 8 } },
					h("button", { type: "button", style: S.btn, onClick: () => setStep(1) }, "重新走绑定引导"),
				) : null,
				step === 0 ? h("h2", { style: S.h2 }, "OneBot 连接") : null,
				step === 0 ? h("div", { style: S.card },
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: () => connectOneBot(), disabled: busy }, busy ? "连接中…" : "连接并读取"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "填好后点连接，直接读取账号、昵称、头像和全部群"),
					),
					h(Field, { label: "OneBot HTTP 端点", value: bot.httpEndpoint, onCommit: (v, c) => setPath(["bot", "httpEndpoint"], v, c) }),
					h(Field, { label: "访问 Token", value: bot.token, type: "password", onCommit: (v, c) => setPath(["bot", "token"], v, c) }),
				) : null,

				h("h2", { style: S.h2 }, "机器人属性"),
				h("div", { style: S.card },
					qqShow > 0 ? h("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } },
						h("img", { src: "https://q1.qlogo.cn/g?b=qq&nk=" + qqShow + "&s=100", width: 48, height: 48, alt: "avatar", style: { borderRadius: "50%", border: "1px solid #e5e7eb", objectFit: "cover" } }),
						h("div", null,
							h("div", { style: { fontSize: 14, fontWeight: 600, color: "#111827" } }, nameShow || "(未命名)"),
							h("div", { style: { fontSize: 12.5, color: "#6b7280" } }, "QQ " + qqShow),
						),
					) : null,
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btnPrimary, onClick: bindAndDetect, disabled: busy }, busy ? "识别中…" : "选择工作区并自动识别"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "选目录后自动识别机器人类型、登录账号、端点和群"),
					),
					msg ? h("div", { style: failed ? S.err : S.ok }, msg) : null,
					h(Field, { label: "昵称", value: bot.name, onCommit: (v, c) => setPath(["bot", "name"], v, c) }),
					h(Field, { label: "机器人 QQ", value: bot.selfQQ, type: "number", onCommit: (v, c) => setPath(["bot", "selfQQ"], Number(v) || 0, c) }),
					h(Field, { label: "OneBot v11 端点", value: bot.httpEndpoint, onCommit: (v, c) => setPath(["bot", "httpEndpoint"], v, c) }),
					h(Field, { label: "QQ 机器人工作区", value: bot.workspacePath, onCommit: (v, c) => setPath(["bot", "workspacePath"], v, c) }),
					h("div", { style: S.row },
						h("span", { style: S.label }, "自动适配工作区"),
						h("label", { style: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 } },
							h("input", { type: "checkbox", checked: autoAdapt, onChange: (e) => setPath(["autoAdapt", "enabled"], e.target.checked, true) }),
							autoAdapt ? "已开启" : "已关闭",
						),
					),
					h("p", { style: S.p }, "修改后自动保存到插件配置；Host 工具读取同一份配置。"),
				),

				h("h2", { style: S.h2 }, "固定群触发方式"),
				h("p", { style: S.p }, "at = 必须 @ 才响应；freechat = 免@按概率响应；off = 完全静默。闭嘴词命中时免@消息静默，真 @ 不受影响。"),
				h("div", { style: S.card },
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btn, onClick: () => loadGroups() }, "刷新群聊列表"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "已发现 " + discovered.length + " 个群（来自日志/文档/OneBot 群列表）"),
					),
					discovered.length > 0 ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 } },
						discovered.map((g) => {
							const exists = groups.some((x) => String(x.groupId) === String(g.id));
							return h("span", { key: g.id, style: { border: "1px solid #e5e7eb", borderRadius: 999, padding: "4px 10px", fontSize: 12.5, display: "inline-flex", gap: 8, alignItems: "center", background: "#f9fafb" } },
								h("span", null, (g.name ? g.name + " · " : "") + g.id),
								h("button", { type: "button", style: { ...S.btn, padding: "2px 8px", fontSize: 12 }, disabled: exists, onClick: () => addDetectedGroup(g) }, exists ? "已添加" : "添加"),
							);
						}),
					) : null,
					groups.length === 0 ? h("p", { style: S.p }, "还没有固定群规则，点下方按钮添加。") :
						h("table", { style: S.table },
							h("thead", null, h("tr", null,
								h("th", { style: S.th }, "群号"),
								h("th", { style: S.th }, "触发方式"),
								h("th", { style: S.th }, "免@概率"),
								h("th", { style: S.th }, "点名概率"),
								h("th", { style: S.th }, "冷却(s)"),
								h("th", { style: S.th }, "闭嘴词（逗号分隔）"),
								h("th", { style: S.th }, ""),
							)),
							h("tbody", null, groups.map((g, i) => h("tr", { key: i },
								h("td", { style: S.td }, h("input", { value: g.groupId || "", style: { ...S.input, minWidth: 110, width: 110 }, onChange: (e) => { setPath(["groups", i, "groupId"], e.target.value, false); setDirty(true); } })),
								h("td", { style: S.td }, h("select", { value: g.mode || "at", style: S.select, onChange: (e) => { setPath(["groups", i, "mode"], e.target.value, false); setDirty(true); } },
									h("option", { value: "at" }, "必须 @"),
									h("option", { value: "freechat" }, "免@概率"),
									h("option", { value: "off" }, "完全静默"),
								)),
								h("td", { style: S.td }, h("input", { type: "number", step: "0.05", min: "0", max: "1", value: String(g.probability ?? 0.2), style: { ...S.input, minWidth: 70, width: 70 }, onChange: (e) => { setPath(["groups", i, "probability"], Number(e.target.value) || 0, false); setDirty(true); } })),
								h("td", { style: S.td }, h("input", { type: "number", step: "0.05", min: "0", max: "1", value: String(g.mentionProbability ?? 0.85), style: { ...S.input, minWidth: 70, width: 70 }, onChange: (e) => { setPath(["groups", i, "mentionProbability"], Number(e.target.value) || 0, false); setDirty(true); } })),
								h("td", { style: S.td }, h("input", { type: "number", step: "30", min: "0", value: String(g.cooldownSec ?? 900), style: { ...S.input, minWidth: 80, width: 80 }, onChange: (e) => { setPath(["groups", i, "cooldownSec"], Number(e.target.value) || 0, false); setDirty(true); } })),
								h("td", { style: S.td }, h("input", { value: (g.muteKeywords || []).join(","), style: { ...S.input, minWidth: 120, width: 120 }, onChange: (e) => { setPath(["groups", i, "muteKeywords"], e.target.value.split(",").map((x) => x.trim()).filter(Boolean), false); setDirty(true); } })),
								h("td", { style: S.td }, h("button", { type: "button", style: S.btnDanger, onClick: () => removeGroup(i) }, "删除")),
							))),
						),
					h("div", { style: { marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } },
						h("button", { type: "button", style: S.btn, onClick: addGroup }, "＋ 添加固定群规则"),
						h("button", { type: "button", style: { ...S.btnPrimary, opacity: dirty ? 1 : 0.6 }, onClick: saveGroups, disabled: !dirty }, dirty ? "保存群设置" : "已保存"),
						dirty ? h("span", { style: { fontSize: 12.5, color: "#b45309" } }, "有未保存的修改") : h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "群参数修改后点保存生效"),
					),
				),

				h("h2", { style: S.h2 }, "同步目标（自动判断）"),
				h("div", { style: S.card },
					h("p", { style: S.p }, "保存群设置后会自动同步并立即生效：机器人端点是本机就写本机 AstrBot 文件；是远程地址就走 SSH 写服务器。无需再点应用。"),
					h(Field, { label: "服务器地址（远程时）", value: remote.host, onCommit: (v, c) => setPath(["remote", "host"], v, c) }),
					h(Field, { label: "SSH 用户", value: remote.user, onCommit: (v, c) => setPath(["remote", "user"], v, c) }),
					h(Field, { label: "SSH 端口", type: "number", value: remote.port, onCommit: (v, c) => setPath(["remote", "port"], Number(v) || 22, c) }),
					h(Field, { label: "私钥路径（可选）", value: remote.keyPath, onCommit: (v, c) => setPath(["remote", "keyPath"], v, c) }),
					h(Field, { label: "远端规则文件", value: remote.jsonPath, onCommit: (v, c) => setPath(["remote", "jsonPath"], v, c) }),
					h("div", { style: { ...S.row, justifyContent: "flex-start", gap: 10 } },
						h("button", { type: "button", style: S.btn, onClick: applyRemote, disabled: busy }, busy ? "同步中…" : "重新同步"),
						h("span", { style: { fontSize: 12.5, color: "#6b7280" } }, "一般不需要手动点；保存失败或改了服务器时可用"),
					),
				),
			);
		}

		const NS = "settings.qqbotSkillpack";
		const zh = { tab: "QQBot 技能包", title: "QQBot 技能包设置", intro: "机器人属性与固定群触发方式。" };
		const en = { tab: "QQBot SkillPack", title: "QQBot SkillPack Settings", intro: "Bot attributes and per-group trigger modes." };

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "qqbot-skillpack: settings dictionaries");
			const t = ctx.locale.bind(NS);
			const pickDirectory = () => {
				try {
					const ui = ctx.get ? ctx.get("uiWorkspace") : ctx.uiWorkspace;
					return ui && typeof ui.pickDirectory === "function" ? ui.pickDirectory() : Promise.resolve(null);
				} catch {
					return Promise.resolve(null);
				}
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "qqbot-skillpack-page",
				order: 46,
				label: () => t("tab"),
				locale: NS,
				inject: () => ({ t, pickDirectory }),
			}, QQBotSettingsPage));
		}

		exports.apply = apply;
		exports.inject = ["slots", "locale", "uiWorkspace"];
		return module.exports;
	},
});
