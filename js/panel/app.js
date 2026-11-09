/**
 * 提示词小助手侧边栏（新版）
 *
 * 设计：
 * - 顶部三段式导航（API / 规则 / 关于），进入详情后变成「返回 + 标题」
 * - 所有交互在面板内完成：列表 → 详情下钻，没有模态、没有横向标签页
 * - 数据由 ./data.js 提供，视图在 ./apiViews.js 与 ./rulesViews.js
 */

import { app } from "../../../scripts/app.js";
import { logger } from "../utils/logger.js";
import { tUI } from "../utils/uiI18n.js";
import { setPanelOpener } from "../modules/panelBridge.js";
import { h, icon, segmented, emptyState } from "./ui.js";
import { loadServices, loadCurrentRoles, loadRules } from "./data.js";
import { apiHome } from "./apiViews.js";
import { rulesHome } from "./rulesViews.js";

export const PANEL_ID = "prompt-assistant.panel";

const TABS = [
    { id: "api", label: () => tUI("API") },
    { id: "rules", label: () => tUI("规则") },
    { id: "about", label: () => tUI("关于") }
];

/** 面板状态 */
const state = {
    tab: "api",
    stack: [],
    services: [],
    current: {},
    rules: { raw: {}, active: {} },
    rulesCategory: "expand",
    container: null,
    loading: true
};

/** 待打开的 tab（在面板尚未渲染时记录） */
let pendingTab = null;

/* ------------------------------------------------------------------ */
/* 视图上下文                                                          */
/* ------------------------------------------------------------------ */

function createContext() {
    return {
        get services() {
            return state.services;
        },
        get current() {
            return state.current;
        },
        get rules() {
            return state.rules;
        },
        get rulesCategory() {
            return state.rulesCategory;
        },
        set rulesCategory(value) {
            state.rulesCategory = value;
        },
        push(view) {
            state.stack.push(view);
            render();
        },
        back() {
            state.stack.pop();
            render();
        },
        refresh() {
            render();
        },
        async reloadServices() {
            state.services = await loadServices();
            state.current = await loadCurrentRoles();
            render();
        },
        async reloadCurrent() {
            state.current = await loadCurrentRoles();
            render();
        },
        async reloadRules() {
            const result = await loadRules();
            state.rules = result;
            render();
        }
    };
}

/* ------------------------------------------------------------------ */
/* 关于                                                                */
/* ------------------------------------------------------------------ */

function aboutView() {
    const root = h("div", { class: "pa-view pa-about" });

    root.appendChild(h("div", { class: "pa-about-title", text: tUI("提示词小助手") }));
    root.appendChild(h("div", { class: "pa-about-version", text: `v${window.PromptAssistant_Version || "?"}` }));
    root.appendChild(
        h("p", {
            class: "pa-about-desc",
            text: tUI("一键调用在线或本地大模型，支持提示词翻译、优化扩写、图像/视频反推、标签收藏与历史记录。")
        })
    );

    const links = [
        { label: tUI("GitHub 仓库"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant" },
        { label: tUI("使用教程"), url: "https://space.bilibili.com/520680644" },
        { label: tUI("问题反馈"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant/issues" },
        { label: tUI("最新版本"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant/releases/latest" }
    ];

    const linkBox = h("div", { class: "pa-about-links" });
    links.forEach((item) => {
        linkBox.appendChild(
            h("a", { class: "pa-about-link", href: item.url, target: "_blank", rel: "noopener noreferrer", text: item.label })
        );
    });
    root.appendChild(linkBox);

    root.appendChild(h("div", { class: "pa-about-section-title", text: tUI("微信交流群") }));
    root.appendChild(
        h("img", {
            class: "pa-about-qr",
            alt: tUI("微信交流群二维码"),
            src: "/extensions/prompt-assistant/assets/wechat.png"
        })
    );

    return root;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function currentView() {
    if (state.stack.length > 0) {
        return state.stack[state.stack.length - 1];
    }
    if (state.tab === "api") return { title: null, render: () => apiHome(createContext()) };
    if (state.tab === "rules") return { title: null, render: () => rulesHome(createContext()) };
    return { title: null, render: () => aboutView() };
}

function render() {
    const root = state.container;
    if (!root) return;

    const view = currentView();
    const isDetail = state.stack.length > 0;

    root.textContent = "";

    // 头部
    const header = h("div", { class: "pa-header" });

    if (isDetail) {
        header.appendChild(
            h(
                "button",
                { type: "button", class: "pa-back", onclick: () => createContext().back() },
                icon("pi-arrow-left"),
                h("span", { text: tUI("返回") })
            )
        );
        header.appendChild(h("div", { class: "pa-header-title", text: view.title || "" }));
    } else {
        header.appendChild(h("div", { class: "pa-header-title", text: tUI("提示词小助手") }));
        header.appendChild(
            segmented({
                items: TABS.map((tab) => ({ id: tab.id, label: tab.label() })),
                value: state.tab,
                onChange: (id) => {
                    state.tab = id;
                    state.stack = [];
                    render();
                }
            })
        );
    }

    root.appendChild(header);

    // 内容
    const body = h("div", { class: "pa-body" });
    root.appendChild(body);

    if (state.loading) {
        body.appendChild(
            h(
                "div",
                { class: "pa-loading" },
                h("span", { class: "pa-spinner" }),
                h("span", { text: tUI("加载中…") })
            )
        );
        return;
    }

    try {
        body.appendChild(view.render(createContext()));
    } catch (error) {
        logger.error(`面板渲染失败: ${error.message}`);
        body.appendChild(
            emptyState({
                iconName: "pi-exclamation-triangle",
                title: tUI("渲染失败"),
                hint: error.message
            })
        );
    }
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

async function loadAll() {
    const [services, current, rules] = await Promise.all([
        loadServices().catch((error) => {
            logger.error(`加载服务商失败: ${error.message}`);
            return [];
        }),
        loadCurrentRoles().catch(() => ({})),
        loadRules().catch((error) => {
            logger.error(`加载规则失败: ${error.message}`);
            return { raw: {}, active: {} };
        })
    ]);

    state.services = services;
    state.current = current;
    state.rules = rules;
    state.loading = false;
}

/**
 * 打开面板
 * @param {string} [tab] api | rules | about
 */
export function openPanel(tab) {
    if (tab) {
        pendingTab = tab;
        if (state.container) {
            state.tab = tab;
            state.stack = [];
            render();
        }
    }

    const sidebarTab = app.extensionManager?.sidebarTab;
    if (!sidebarTab) {
        logger.error("当前 ComfyUI 版本不支持 sidebarTab API");
        return;
    }

    if (sidebarTab.activeSidebarTabId !== PANEL_ID) {
        sidebarTab.toggleSidebarTab(PANEL_ID);
    }
}

/** 注册侧边栏（扩展 setup 阶段调用一次） */
export function registerSidebarPanel() {
    setPanelOpener(openPanel);

    app.extensionManager.registerSidebarTab({
        id: PANEL_ID,
        icon: "pi pi-sparkles",
        title: tUI("提示词小助手"),
        tooltip: tUI("提示词小助手：API 配置与提示词规则"),
        type: "custom",
        render: (el) => {
            const root = h("div", { class: "pa-panel" });
            el.appendChild(root);

            state.container = root;
            state.tab = pendingTab || "api";
            state.stack = [];
            state.loading = true;
            pendingTab = null;
            render();

            loadAll()
                .then(() => render())
                .catch((error) => {
                    logger.error(`面板初始化失败: ${error.message}`);
                    state.loading = false;
                    render();
                });

            return () => {
                state.container = null;
                root.remove();
            };
        }
    });

    logger.log("提示词小助手侧边栏已注册");
}
