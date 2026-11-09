/**
 * 侧边栏面板的 UI 基础组件
 *
 * 设计目标：窄栏（300–420px）、卡片式、单列、可点击区域大、无模态。
 * 只用 ComfyUI 主题变量，不依赖 PrimeVue。
 */

/**
 * 创建元素
 * @param {string} tag
 * @param {Object} [props]
 * @param {...(Node|string|false|null|undefined)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(props || {})) {
        if (value === null || value === undefined || value === false) continue;

        if (key === "class") {
            el.className = value;
        } else if (key === "text") {
            el.textContent = value;
        } else if (key === "html") {
            el.innerHTML = value;
        } else if (key === "style" && typeof value === "object") {
            Object.assign(el.style, value);
        } else if (key === "dataset" && typeof value === "object") {
            Object.assign(el.dataset, value);
        } else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) {
            el.setAttribute(key, "");
        } else {
            el.setAttribute(key, value);
        }
    }

    appendChildren(el, children);
    return el;
}

function appendChildren(el, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) {
            appendChildren(el, child);
        } else if (child instanceof Node) {
            el.appendChild(child);
        } else {
            el.appendChild(document.createTextNode(String(child)));
        }
    }
}

/** 图标（PrimeIcons 仍由宿主加载） */
export function icon(name, extraClass = "") {
    return h("i", { class: `pi ${name} ${extraClass}`.trim(), "aria-hidden": "true" });
}

/**
 * 按钮
 * @param {Object} opts
 * @param {string} opts.label
 * @param {"primary"|"secondary"|"ghost"|"danger"} [opts.variant]
 * @param {string} [opts.iconName]
 * @param {Function} [opts.onClick]
 * @param {boolean} [opts.block]
 * @param {string} [opts.title]
 */
export function button({ label, variant = "secondary", iconName, onClick, block = false, title }) {
    const el = h(
        "button",
        {
            type: "button",
            class: `pa-btn pa-btn--${variant}${block ? " pa-btn--block" : ""}`,
            title: title || label,
            onclick: onClick
        },
        iconName ? icon(iconName) : null,
        label ? h("span", { text: label }) : null
    );
    return el;
}

/** 图标按钮 */
export function iconButton({ iconName, title, onClick, variant = "ghost" }) {
    return h(
        "button",
        {
            type: "button",
            class: `pa-icon-btn pa-icon-btn--${variant}`,
            title,
            "aria-label": title,
            onclick: onClick
        },
        icon(iconName)
    );
}

/** 卡片 */
export function card(...children) {
    return h("div", { class: "pa-card" }, ...children);
}

/** 分组标题 + 可选右侧操作 */
export function sectionHeader(title, action = null, subtitle = null) {
    return h(
        "div",
        { class: "pa-section-header" },
        h(
            "div",
            { class: "pa-section-header-text" },
            h("div", { class: "pa-section-title", text: title }),
            subtitle ? h("div", { class: "pa-section-subtitle", text: subtitle }) : null
        ),
        action
    );
}

/**
 * 可点击的行（列表项）
 * @param {Object} opts
 * @param {Node|string} opts.leading
 * @param {Node|string} opts.title
 * @param {Node|string} [opts.subtitle]
 * @param {Node} [opts.trailing]
 * @param {Function} [opts.onClick]
 */
export function row({ leading, title, subtitle, trailing, onClick }) {
    const el = h(
        "div",
        { class: `pa-row${onClick ? " pa-row--clickable" : ""}`, role: onClick ? "button" : null, tabindex: onClick ? "0" : null },
        leading ? h("div", { class: "pa-row-leading" }, leading) : null,
        h(
            "div",
            { class: "pa-row-main" },
            typeof title === "string" ? h("div", { class: "pa-row-title", text: title }) : title,
            subtitle
                ? typeof subtitle === "string"
                    ? h("div", { class: "pa-row-subtitle", text: subtitle })
                    : subtitle
                : null
        ),
        trailing ? h("div", { class: "pa-row-trailing" }, trailing) : null
    );

    if (onClick) {
        el.addEventListener("click", onClick);
        el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
            }
        });
    }

    return el;
}

/**
 * 表单字段
 * @param {Object} opts
 * @param {string} opts.label
 * @param {HTMLElement} opts.input
 * @param {string} [opts.hint]
 */
export function field({ label, input, hint }) {
    return h(
        "label",
        { class: "pa-field" },
        h("span", { class: "pa-field-label", text: label }),
        input,
        hint ? h("span", { class: "pa-field-hint", text: hint }) : null
    );
}

/** 文本输入 */
export function textInput({ value = "", placeholder = "", type = "text", onInput, autofocus = false }) {
    const input = h("input", {
        class: "pa-input",
        type,
        value,
        placeholder,
        autocomplete: "off",
        spellcheck: "false"
    });
    if (onInput) input.addEventListener("input", () => onInput(input.value));
    if (autofocus) setTimeout(() => input.focus(), 30);
    return input;
}

/** 多行输入 */
export function textArea({ value = "", placeholder = "", rows = 12, onInput }) {
    const el = h("textarea", { class: "pa-textarea", placeholder, rows });
    el.value = value;
    if (onInput) el.addEventListener("input", () => onInput(el.value));
    return el;
}

/**
 * 开关行
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} [opts.hint]
 * @param {boolean} opts.checked
 * @param {Function} opts.onChange
 */
export function switchRow({ label, hint, checked, onChange }) {
    const sw = h("button", {
        type: "button",
        class: `pa-switch${checked ? " is-on" : ""}`,
        role: "switch",
        "aria-checked": checked ? "true" : "false"
    });
    sw.appendChild(h("span", { class: "pa-switch-thumb" }));

    sw.addEventListener("click", () => {
        const next = !sw.classList.contains("is-on");
        sw.classList.toggle("is-on", next);
        sw.setAttribute("aria-checked", next ? "true" : "false");
        onChange(next);
    });

    return h(
        "div",
        { class: "pa-switch-row" },
        h(
            "div",
            { class: "pa-switch-text" },
            h("div", { class: "pa-row-title", text: label }),
            hint ? h("div", { class: "pa-row-subtitle", text: hint }) : null
        ),
        sw
    );
}

/** 页签胶囊（分段控件） */
export function segmented({ items, value, onChange, scrollable = false }) {
    const bar = h("div", { class: `pa-segmented${scrollable ? " pa-segmented--scroll" : ""}`, role: "tablist" });
    const buttons = new Map();

    items.forEach((item) => {
        const btn = h("button", {
            type: "button",
            class: `pa-segmented-item${item.id === value ? " is-active" : ""}`,
            role: "tab",
            "aria-selected": item.id === value ? "true" : "false",
            text: item.label
        });
        btn.addEventListener("click", () => {
            if (item.id === value) return;
            value = item.id;
            buttons.forEach((b, id) => {
                const active = id === item.id;
                b.classList.toggle("is-active", active);
                b.setAttribute("aria-selected", active ? "true" : "false");
            });
            onChange(item.id);
        });
        buttons.set(item.id, btn);
        bar.appendChild(btn);
    });

    return bar;
}

/** 小徽章 */
export function badge(text, tone = "muted") {
    return h("span", { class: `pa-badge pa-badge--${tone}`, text });
}

/** 空状态 */
export function emptyState({ iconName = "pi-inbox", title, hint }) {
    return h(
        "div",
        { class: "pa-empty" },
        h("div", { class: "pa-empty-icon" }, icon(iconName)),
        h("div", { class: "pa-empty-title", text: title }),
        hint ? h("div", { class: "pa-empty-hint", text: hint }) : null
    );
}

/** 轻提示 */
export function toast(severity, summary, detail) {
    try {
        app.extensionManager.toast.add({ severity, summary, detail, life: severity === "error" ? 5000 : 2500 });
    } catch (error) {
        console[severity === "error" ? "error" : "log"]("[PromptAssistant]", summary, detail || "");
    }
}

/** 按钮忙碌态包装：执行期间禁用并显示加载中 */
export async function withBusy(btn, task) {
    if (!btn || btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.classList.add("is-busy");
    const original = btn.innerHTML;
    btn.innerHTML = "";
    btn.appendChild(h("span", { class: "pa-spinner" }));
    try {
        return await task();
    } finally {
        btn.dataset.busy = "";
        btn.classList.remove("is-busy");
        btn.innerHTML = original;
    }
}

/** 确认框（官方 dialog） */
export async function confirmDialog({ title, message, type = "default", confirmLabel }) {
    try {
        return await app.extensionManager.dialog.confirm({ title, message, type });
    } catch (error) {
        return window.confirm(`${title}\n\n${message}`);
    }
}
