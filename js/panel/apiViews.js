/**
 * API 分区视图
 *
 * 交互模型：列表 → 详情（下钻），不做横向标签页、不做模态。
 * - 首页：当前使用的服务（3 个角色）+ 服务商列表
 * - 服务商详情：名称 / 地址 / Key / 开关 / 模型管理
 * - 角色选择：选服务商（百度翻译作为翻译角色的特殊项）
 */

import {
    h,
    button,
    iconButton,
    card,
    row,
    field,
    textInput,
    switchRow,
    badge,
    emptyState,
    sectionHeader,
    icon,
    toast,
    withBusy,
    confirmDialog
} from "./ui.js";
import {
    ROLES,
    setCurrentRole,
    createService,
    updateService,
    deleteService,
    addModel,
    deleteModel,
    setDefaultModel
} from "./data.js";

const CHEVRON = () => h("i", { class: "pi pi-angle-right pa-chevron", "aria-hidden": "true" });

function serviceHost(service) {
    try {
        return new URL(service.base_url).host;
    } catch (error) {
        return service.base_url || "未配置地址";
    }
}

function defaultModelName(service, roleId) {
    const list = roleId === "vlm" ? service.vlm_models : service.llm_models;
    const models = list || [];
    const def = models.find((model) => model.is_default) || models[0];
    return def ? def.name : null;
}

function serviceName(ctx, serviceId) {
    if (serviceId === "baidu") return "百度翻译";
    const service = (ctx.services || []).find((item) => item.id === serviceId);
    return service ? service.name : serviceId || "未选择";
}

/* ------------------------------------------------------------------ */
/* 首页                                                                */
/* ------------------------------------------------------------------ */

export function apiHome(ctx) {
    const root = h("div", { class: "pa-view" });

    root.appendChild(
        sectionHeader("当前使用", null, "点击切换每个功能使用的服务")
    );

    const currentCard = card();
    ROLES.forEach((role, index) => {
        const current = (ctx.current && ctx.current[role.id]) || {};
        const subtitle = `${serviceName(ctx, current.provider)}${current.model ? ` · ${current.model}` : ""}`;

        if (index > 0) currentCard.appendChild(h("div", { class: "pa-divider" }));

        currentCard.appendChild(
            row({
                leading: h("span", { class: "pa-role-dot" }),
                title: role.label,
                subtitle,
                trailing: CHEVRON(),
                onClick: () => ctx.push({ id: `role-${role.id}`, title: role.label, render: (c) => rolePicker(c, role.id) })
            })
        );
    });
    root.appendChild(currentCard);

    root.appendChild(
        sectionHeader(
            "服务商",
            button({
                label: "新增",
                variant: "secondary",
                iconName: "pi-plus",
                onClick: () => ctx.push({ id: "provider-new", title: "新增服务商", render: (c) => providerCreate(c) })
            }),
            `${(ctx.services || []).length} 个`
        )
    );

    if (!ctx.services || ctx.services.length === 0) {
        root.appendChild(emptyState({ iconName: "pi-server", title: "还没有服务商", hint: "点击右上角「新增」添加一个 OpenAI 兼容服务" }));
        return root;
    }

    const list = card();
    ctx.services.forEach((service, index) => {
        if (index > 0) list.appendChild(h("div", { class: "pa-divider" }));

        list.appendChild(
            row({
                leading: h(
                    "span",
                    { class: `pa-service-avatar${service.has_api_key ? " is-ready" : ""}` },
                    service.name.slice(0, 1).toUpperCase()
                ),
                title: service.name,
                subtitle: serviceHost(service),
                trailing: h(
                    "div",
                    { class: "pa-row-trailing" },
                    !service.has_api_key ? badge("未填 Key", "warn") : null,
                    CHEVRON()
                ),
                onClick: () => ctx.push({ id: `provider-${service.id}`, title: service.name, render: (c) => providerDetail(c, service.id) })
            })
        );
    });
    root.appendChild(list);

    return root;
}

/* ------------------------------------------------------------------ */
/* 服务商详情                                                          */
/* ------------------------------------------------------------------ */

export function providerDetail(ctx, serviceId) {
    const service = (ctx.services || []).find((item) => item.id === serviceId);
    const root = h("div", { class: "pa-view" });

    if (!service) {
        root.appendChild(emptyState({ iconName: "pi-exclamation-triangle", title: "服务商不存在", hint: "它可能已被删除" }));
        return root;
    }

    const draft = {
        name: service.name || "",
        base_url: service.base_url || "",
        api_key: "",
        disable_thinking: !!service.disable_thinking,
        enable_advanced_params: !!service.enable_advanced_params,
        filter_thinking_output: !!service.filter_thinking_output
    };

    const hasKey = !!service.has_api_key;

    root.appendChild(
        h(
            "div",
            { class: "pa-detail-meta" },
            h("span", { text: serviceHost(service) }),
            badge(`LLM ${(service.llm_models || []).length}`, "muted"),
            badge(`VLM ${(service.vlm_models || []).length}`, "muted")
        )
    );

    root.appendChild(
        h(
            "div",
            { class: "pa-form" },
            field({ label: "名称", input: textInput({ value: draft.name, placeholder: "服务商名称", onInput: (v) => (draft.name = v) }) }),
            field({
                label: "Base URL",
                input: textInput({ value: draft.base_url, placeholder: "https://api.example.com/v1", onInput: (v) => (draft.base_url = v) })
            })
        )
    );

    // API Key（带显示/隐藏）
    const keyInput = textInput({
        value: "",
        type: "password",
        placeholder: hasKey ? "已保存，留空表示不修改" : "sk-...",
        onInput: (v) => (draft.api_key = v)
    });
    const eyeBtn = iconButton({
        iconName: "pi-eye",
        title: "显示 / 隐藏",
        onClick: () => {
            const show = keyInput.type === "password";
            keyInput.type = show ? "text" : "password";
            eyeBtn.innerHTML = "";
            eyeBtn.appendChild(icon(show ? "pi-eye-slash" : "pi-eye"));
        }
    });

    root.appendChild(
        h(
            "div",
            { class: "pa-form" },
            field({ label: "API Key", input: h("div", { class: "pa-input-with-action" }, keyInput, eyeBtn) })
        )
    );

    // 开关
    const toggles = card(
        switchRow({
            label: "关闭思维链",
            hint: "请求里禁用 reasoning 输出",
            checked: draft.disable_thinking,
            onChange: (v) => (draft.disable_thinking = v)
        }),
        h("div", { class: "pa-divider" }),
        switchRow({
            label: "启用高级参数",
            hint: "允许为每个模型设置 temperature / top_p",
            checked: draft.enable_advanced_params,
            onChange: (v) => (draft.enable_advanced_params = v)
        }),
        h("div", { class: "pa-divider" }),
        switchRow({
            label: "过滤思维链输出",
            hint: "丢弃返回中的思考过程",
            checked: draft.filter_thinking_output,
            onChange: (v) => (draft.filter_thinking_output = v)
        })
    );
    root.appendChild(toggles);

    // 模型
    root.appendChild(modelSection(ctx, service, "llm", "语言模型（LLM）"));
    root.appendChild(modelSection(ctx, service, "vlm", "视觉模型（VLM）"));

    // 操作
    const saveBtn = button({
        label: "保存修改",
        variant: "primary",
        iconName: "pi-check",
        block: true,
        onClick: async () => {
            if (!draft.name.trim()) return toast("warn", "名称不能为空");
            await withBusy(saveBtn, async () => {
                try {
                    const patch = {
                        name: draft.name.trim(),
                        base_url: draft.base_url.trim(),
                        disable_thinking: draft.disable_thinking,
                        enable_advanced_params: draft.enable_advanced_params,
                        filter_thinking_output: draft.filter_thinking_output
                    };
                    if (draft.api_key.trim()) patch.api_key = draft.api_key.trim();
                    await updateService(service.id, patch);
                    toast("success", "已保存");
                    await ctx.reloadServices();
                    ctx.back();
                } catch (error) {
                    toast("error", "保存失败", error.message);
                }
            });
        }
    });

    const deleteBtn = button({
        label: "删除服务商",
        variant: "danger",
        iconName: "pi-trash",
        block: true,
        onClick: async () => {
            const ok = await confirmDialog({
                title: "删除服务商",
                message: `确定删除「${service.name}」？该操作不可撤销。`,
                type: "delete"
            });
            if (!ok) return;
            await withBusy(deleteBtn, async () => {
                try {
                    await deleteService(service.id);
                    toast("success", "已删除");
                    await ctx.reloadServices();
                    ctx.back();
                } catch (error) {
                    toast("error", "删除失败", error.message);
                }
            });
        }
    });

    root.appendChild(h("div", { class: "pa-actions" }, saveBtn, deleteBtn));
    return root;
}

/** 模型分组：默认模型 + 删除 + 新增 */
function modelSection(ctx, service, modelType, title) {
    const list = (modelType === "llm" ? service.llm_models : service.vlm_models) || [];
    const wrap = h("div", { class: "pa-model-section" });
    wrap.appendChild(sectionHeader(title, badge(String(list.length), "muted")));

    const chips = h("div", { class: "pa-chips" });

    list.forEach((model) => {
        const chip = h(
            "span",
            { class: `pa-chip${model.is_default ? " is-default" : ""}` },
            h("button", {
                type: "button",
                class: "pa-chip-label",
                title: model.is_default ? "当前默认模型" : "设为默认模型",
                onclick: async () => {
                    try {
                        await setDefaultModel(service.id, modelType, model.name);
                        toast("success", `默认模型：${model.name}`);
                        await ctx.reloadServices();
                        ctx.refresh();
                    } catch (error) {
                        toast("error", "设置默认模型失败", error.message);
                    }
                }
            },
                model.is_default ? icon("pi-star-fill") : icon("pi-star"),
                h("span", { text: model.name })
            ),
            h("button", {
                type: "button",
                class: "pa-chip-remove",
                title: "删除模型",
                onclick: async () => {
                    const ok = await confirmDialog({
                        title: "删除模型",
                        message: `确定删除模型「${model.name}」？`,
                        type: "delete"
                    });
                    if (!ok) return;
                    try {
                        await deleteModel(service.id, modelType, model.name);
                        toast("success", "模型已删除");
                        await ctx.reloadServices();
                        ctx.refresh();
                    } catch (error) {
                        toast("error", "删除失败", error.message);
                    }
                }
            }, icon("pi-times"))
        );
        chips.appendChild(chip);
    });

    if (list.length === 0) {
        chips.appendChild(h("span", { class: "pa-chips-empty", text: "暂无模型" }));
    }

    wrap.appendChild(chips);

    // 新增模型：点击后展开输入行
    const addRow = h("div", { class: "pa-inline-add" });
    const addBtn = button({
        label: "添加模型",
        variant: "ghost",
        iconName: "pi-plus",
        onClick: () => {
            if (addRow.dataset.open === "1") return;
            addRow.dataset.open = "1";
            addRow.textContent = "";

            const input = textInput({ placeholder: "模型名称，如 glm-4-flash", autofocus: true });
            const confirm = button({
                label: "添加",
                variant: "primary",
                onClick: async () => {
                    const name = input.value.trim();
                    if (!name) return toast("warn", "请输入模型名称");
                    await withBusy(confirm, async () => {
                        try {
                            await addModel(service.id, modelType, name);
                            toast("success", `已添加 ${name}`);
                            await ctx.reloadServices();
                            ctx.refresh();
                        } catch (error) {
                            toast("error", "添加失败", error.message);
                        }
                    });
                }
            });
            const cancel = iconButton({ iconName: "pi-times", title: "取消", onClick: () => ctx.refresh() });

            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") confirm.click();
                if (event.key === "Escape") ctx.refresh();
            });

            addRow.appendChild(input);
            addRow.appendChild(confirm);
            addRow.appendChild(cancel);
        }
    });

    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);
    return wrap;
}

/* ------------------------------------------------------------------ */
/* 新增服务商                                                          */
/* ------------------------------------------------------------------ */

export function providerCreate(ctx) {
    const draft = { name: "", description: "" };
    const root = h("div", { class: "pa-view" });

    root.appendChild(
        h(
            "div",
            { class: "pa-form" },
            field({ label: "名称", input: textInput({ placeholder: "例如：硅基流动", onInput: (v) => (draft.name = v), autofocus: true }) }),
            field({
                label: "介绍（可选）",
                input: textInput({ placeholder: "一句话说明这个服务商", onInput: (v) => (draft.description = v) })
            })
        )
    );

    const hint = h("p", {
        class: "pa-hint",
        text: "创建后会自动填入示例地址，进入详情页再改成真实地址和 Key。"
    });
    root.appendChild(hint);

    const createBtn = button({
        label: "创建",
        variant: "primary",
        iconName: "pi-plus",
        block: true,
        onClick: async () => {
            const name = draft.name.trim();
            if (!name) return toast("warn", "请输入服务商名称");
            await withBusy(createBtn, async () => {
                try {
                    const result = await createService({ name, description: draft.description.trim() });
                    toast("success", "已创建");
                    await ctx.reloadServices();
                    const newId = result && (result.id || (result.service && result.service.id));
                    ctx.back();
                    if (newId) {
                        ctx.push({ id: `provider-${newId}`, title: name, render: (c) => providerDetail(c, newId) });
                    }
                } catch (error) {
                    toast("error", "创建失败", error.message);
                }
            });
        }
    });

    root.appendChild(h("div", { class: "pa-actions" }, createBtn));
    return root;
}

/* ------------------------------------------------------------------ */
/* 角色选择                                                            */
/* ------------------------------------------------------------------ */

export function rolePicker(ctx, roleId) {
    const role = ROLES.find((item) => item.id === roleId);
    const current = (ctx.current && ctx.current[roleId]) || {};
    const root = h("div", { class: "pa-view" });

    root.appendChild(sectionHeader("选择服务商", null, "只显示该功能可用的服务"));

    const list = card();
    let count = 0;

    if (roleId === "translate") {
        count++;
        list.appendChild(
            row({
                leading: h("span", { class: "pa-service-avatar" }, "百"),
                title: "百度翻译",
                subtitle: "内置机器翻译",
                trailing: current.provider === "baidu" ? badge("使用中", "primary") : null,
                onClick: () => applyRole(ctx, roleId, "baidu")
            })
        );
    }

    (ctx.services || []).forEach((service) => {
        const model = defaultModelName(service, roleId);
        const available = roleId === "translate" ? true : !!model;

        if (count > 0) list.appendChild(h("div", { class: "pa-divider" }));
        count++;

        list.appendChild(
            row({
                leading: h(
                    "span",
                    { class: `pa-service-avatar${service.has_api_key ? " is-ready" : ""}` },
                    service.name.slice(0, 1).toUpperCase()
                ),
                title: service.name,
                subtitle: model || (roleId === "translate" ? "使用默认语言模型" : "没有可用模型"),
                trailing:
                    current.provider === service.id
                        ? badge("使用中", "primary")
                        : available
                          ? null
                          : badge("不可用", "warn"),
                onClick: available
                    ? () => applyRole(ctx, roleId, service.id)
                    : () => toast("warn", "该服务商没有此功能可用的模型")
            })
        );
    });

    root.appendChild(list);

    if (count === 0) {
        root.appendChild(emptyState({ iconName: "pi-server", title: "没有可用服务", hint: "先到「API」里添加服务商" }));
    }

    return root;
}

async function applyRole(ctx, roleId, serviceId) {
    try {
        await setCurrentRole(roleId, serviceId);
        toast("success", `已切换：${serviceName(ctx, serviceId)}`);
        await ctx.reloadCurrent();
        ctx.back();
    } catch (error) {
        toast("error", "切换失败", error.message);
    }
}
