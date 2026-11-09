/**
 * 规则分区视图
 *
 * 交互模型：
 * - 顶部类别胶囊（5 类），下面直接是规则卡片列表
 * - 每条规则：左侧星标（默认规则）、名称、内容预览
 * - 点整行进入编辑页（下钻），编辑页里保存 / 设为默认 / 删除
 */

import {
    h,
    button,
    card,
    row,
    field,
    textInput,
    textArea,
    badge,
    emptyState,
    sectionHeader,
    icon,
    toast,
    withBusy,
    confirmDialog,
    segmented
} from "./ui.js";
import {
    RULE_CATEGORIES,
    categoryById,
    listRules,
    activeRuleId,
    writeRule,
    removeRule,
    setActiveRule,
    saveRules
} from "./data.js";

const CHEVRON = () => h("i", { class: "pi pi-angle-right pa-chevron", "aria-hidden": "true" });

function preview(text) {
    const flat = String(text || "").replace(/\s+/g, " ").trim();
    return flat.length > 72 ? `${flat.slice(0, 72)}…` : flat || "（空内容）";
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

export function rulesHome(ctx) {
    const root = h("div", { class: "pa-view" });

    const categoryId = ctx.rulesCategory || RULE_CATEGORIES[0].id;
    const category = categoryById(categoryId);

    root.appendChild(
        segmented({
            items: RULE_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
            value: categoryId,
            scrollable: true,
            onChange: (id) => {
                ctx.rulesCategory = id;
                ctx.refresh();
            }
        })
    );

    const rules = listRules(ctx.rules.raw, category);
    const activeId = activeRuleId(ctx.rules.active, category);

    root.appendChild(
        sectionHeader(
            `${category.label}规则`,
            button({
                label: "新建",
                variant: "secondary",
                iconName: "pi-plus",
                onClick: () => ctx.push({ id: `rule-new-${category.id}`, title: "新建规则", render: (c) => ruleEditor(c, category.id, null) })
            }),
            `${rules.length} 条`
        )
    );

    if (rules.length === 0) {
        root.appendChild(emptyState({ iconName: "pi-list", title: "这个分类还没有规则", hint: "点击「新建」添加一条" }));
        return root;
    }

    const list = card();
    rules.forEach((rule, index) => {
        if (index > 0) list.appendChild(h("div", { class: "pa-divider" }));

        const isActive = rule.id === activeId;
        const star = h(
            "button",
            {
                type: "button",
                class: `pa-star${isActive ? " is-active" : ""}`,
                title: isActive ? "当前默认规则" : "设为默认规则",
                "aria-label": isActive ? "当前默认规则" : "设为默认规则"
            },
            icon(isActive ? "pi-star-fill" : "pi-star")
        );

        star.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!category.activeKey) return toast("warn", "翻译规则不需要设置默认");
            try {
                setActiveRule(ctx.rules.raw, category, rule.id);
                await saveRules(ctx.rules.raw);
                ctx.rules.active = ctx.rules.raw.active_prompts || {};
                toast("success", `默认规则：${rule.name}`);
                ctx.refresh();
            } catch (error) {
                toast("error", "设置失败", error.message);
            }
        });

        list.appendChild(
            row({
                leading: star,
                title: rule.name,
                subtitle: preview(rule.content),
                trailing: CHEVRON(),
                onClick: () =>
                    ctx.push({
                        id: `rule-${category.id}-${rule.id}`,
                        title: rule.name,
                        render: (c) => ruleEditor(c, category.id, rule.id)
                    })
            })
        );
    });

    root.appendChild(list);
    return root;
}

/* ------------------------------------------------------------------ */
/* 编辑                                                                */
/* ------------------------------------------------------------------ */

export function ruleEditor(ctx, categoryId, ruleId) {
    const category = categoryById(categoryId);
    const existing = ruleId ? listRules(ctx.rules.raw, category).find((rule) => rule.id === ruleId) : null;
    const isTranslate = category.id === "translate";
    const activeId = activeRuleId(ctx.rules.active, category);

    const draft = {
        name: existing ? existing.name : "",
        content: existing ? existing.content : ""
    };

    const root = h("div", { class: "pa-view pa-view--editor" });

    if (!isTranslate) {
        root.appendChild(
            h(
                "div",
                { class: "pa-form" },
                field({
                    label: "规则名称",
                    input: textInput({
                        value: draft.name,
                        placeholder: "例如：扩写-通用",
                        onInput: (v) => (draft.name = v),
                        autofocus: !existing
                    })
                })
            )
        );
    } else {
        root.appendChild(
            h(
                "div",
                { class: "pa-form" },
                field({ label: "语言", input: h("div", { class: "pa-readonly", text: draft.name || "ZH" }) })
            )
        );
    }

    const counter = h("span", { class: "pa-counter", text: `${draft.content.length} 字` });
    const area = textArea({
        value: draft.content,
        rows: 14,
        placeholder: "输入系统提示词 / 规则内容…",
        onInput: (v) => {
            draft.content = v;
            counter.textContent = `${v.length} 字`;
        }
    });

    root.appendChild(
        h(
            "div",
            { class: "pa-form pa-form--grow" },
            h("div", { class: "pa-field-label-row" }, h("span", { class: "pa-field-label", text: "规则内容" }), counter),
            area
        )
    );

    const saveBtn = button({
        label: "保存",
        variant: "primary",
        iconName: "pi-check",
        block: true,
        onClick: async () => {
            if (!isTranslate && !draft.name.trim()) return toast("warn", "请填写规则名称");
            if (!draft.content.trim()) return toast("warn", "规则内容不能为空");

            await withBusy(saveBtn, async () => {
                try {
                    const id = writeRule(ctx.rules.raw, category, {
                        id: existing ? existing.id : undefined,
                        name: draft.name.trim(),
                        content: draft.content
                    });

                    // 新建的第一条规则自动设为默认
                    const hasActive = !!activeRuleId(ctx.rules.active, category);
                    if (!existing && category.activeKey && !hasActive) {
                        setActiveRule(ctx.rules.raw, category, id);
                    }

                    await saveRules(ctx.rules.raw);
                    await ctx.reloadRules();
                    toast("success", "规则已保存");
                    ctx.back();
                } catch (error) {
                    toast("error", "保存失败", error.message);
                }
            });
        }
    });

    root.appendChild(h("div", { class: "pa-actions" }, saveBtn));

    const secondary = h("div", { class: "pa-actions pa-actions--split" });

    if (existing && category.activeKey) {
        const isActive = existing.id === activeId;
        secondary.appendChild(
            button({
                label: isActive ? "当前默认" : "设为默认",
                variant: "secondary",
                iconName: isActive ? "pi-star-fill" : "pi-star",
                onClick: async (event) => {
                    if (isActive) return;
                    try {
                        setActiveRule(ctx.rules.raw, category, existing.id);
                        await saveRules(ctx.rules.raw);
                        await ctx.reloadRules();
                        toast("success", "已设为默认规则");
                        ctx.refresh();
                    } catch (error) {
                        toast("error", "设置失败", error.message);
                    }
                }
            })
        );
    }

    if (existing) {
        secondary.appendChild(
            button({
                label: "删除",
                variant: "danger",
                iconName: "pi-trash",
                onClick: async () => {
                    const ok = await confirmDialog({
                        title: "删除规则",
                        message: `确定删除「${existing.name}」？该操作不可撤销。`,
                        type: "delete"
                    });
                    if (!ok) return;
                    try {
                        removeRule(ctx.rules.raw, category, existing.id);
                        await saveRules(ctx.rules.raw);
                        await ctx.reloadRules();
                        toast("success", "规则已删除");
                        ctx.back();
                    } catch (error) {
                        toast("error", "删除失败", error.message);
                    }
                }
            })
        );
    }

    root.appendChild(secondary);
    return root;
}
