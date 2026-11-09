/**
 * 提示词小助手侧边栏面板（官方 registerSidebarTab API）
 *
 * Phase 2 重构：把原来的「API 管理器 / 规则管理器」两个自绘模态弹窗
 * 迁到 ComfyUI 官方侧边栏 Tab 中。面板内是普通 DOM，不再需要：
 *   - z-index 计算 / 遮罩层 / pointer-events 补丁
 *   - 外部点击关闭、[role="dialog"] 挂载、重复打开保护
 *
 * 结构：
 *   ┌ 提示词小助手 ────────────────┐
 *   │ [API 配置] [规则配置] [关于] │
 *   │ ─────────────────────────── │
 *   │  分区内容（懒加载）          │
 *   └─────────────────────────────┘
 */

import { app } from "../../../scripts/app.js";
import { logger } from "../utils/logger.js";
import { tUI } from "../utils/uiI18n.js";
import { apiConfigManager } from "./apiConfigManager.js";
import { rulesConfigManager } from "./rulesConfigManager.js";
import { setPanelOpener } from "./panelBridge.js";

export const PANEL_ID = "prompt-assistant.panel";

/** 面板当前分区（用于「打开面板并定位到某个分区」） */
let pendingSection = "api";
/** 当前挂载的面板实例 */
let panelInstance = null;

const SECTIONS = [
    {
        id: "api",
        title: () => tUI("API 配置"),
        mount: (el) => apiConfigManager.mount(el)
    },
    {
        id: "rules",
        title: () => tUI("规则配置"),
        mount: (el) => rulesConfigManager.mount(el)
    },
    {
        id: "about",
        title: () => tUI("关于"),
        mount: (el) => renderAbout(el)
    }
];

/**
 * 渲染「关于」分区
 * @param {HTMLElement} el
 */
function renderAbout(el) {
    el.textContent = "";

    const wrap = document.createElement("div");
    wrap.className = "pa-about";

    const title = document.createElement("div");
    title.className = "pa-about-title";
    title.textContent = tUI("提示词小助手");
    wrap.appendChild(title);

    const version = document.createElement("div");
    version.className = "pa-about-version";
    version.textContent = `v${window.PromptAssistant_Version || "?"}`;
    wrap.appendChild(version);

    const desc = document.createElement("p");
    desc.className = "pa-about-desc";
    desc.textContent = tUI(
        "一键调用在线或本地大模型，支持提示词翻译、优化扩写、图像/视频反推、标签收藏与历史记录。"
    );
    wrap.appendChild(desc);

    const links = document.createElement("div");
    links.className = "pa-about-links";

    const linkDefs = [
        { label: tUI("GitHub 仓库"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant" },
        { label: tUI("使用教程（B 站）"), url: "https://space.bilibili.com/520680644" },
        { label: tUI("问题反馈"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant/issues" },
        { label: tUI("最新版本"), url: "https://github.com/yawiii/ComfyUI-Prompt-Assistant/releases/latest" }
    ];

    linkDefs.forEach((item) => {
        const a = document.createElement("a");
        a.className = "pa-about-link";
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = item.label;
        links.appendChild(a);
    });

    wrap.appendChild(links);

    const qrTitle = document.createElement("div");
    qrTitle.className = "pa-about-section-title";
    qrTitle.textContent = tUI("微信交流群");
    wrap.appendChild(qrTitle);

    const qr = document.createElement("img");
    qr.className = "pa-about-qr";
    qr.alt = tUI("微信交流群二维码");
    qr.src = "/extensions/prompt-assistant/assets/wechat.png";
    wrap.appendChild(qr);

    el.appendChild(wrap);
}

/**
 * 构建面板 DOM
 * @returns {{root: HTMLElement, activate: Function, destroy: Function}}
 */
function buildPanel() {
    const root = document.createElement("div");
    root.className = "pa-panel";

    const tabBar = document.createElement("div");
    tabBar.className = "pa-panel-tabs";
    tabBar.setAttribute("role", "tablist");

    const body = document.createElement("div");
    body.className = "pa-panel-body";

    /** @type {Record<string, HTMLElement>} */
    const panes = {};
    /** @type {Record<string, HTMLButtonElement>} */
    const buttons = {};

    SECTIONS.forEach((section) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pa-panel-tab";
        button.dataset.section = section.id;
        button.setAttribute("role", "tab");
        button.textContent = section.title();
        button.addEventListener("click", () => activate(section.id));
        tabBar.appendChild(button);
        buttons[section.id] = button;

        const pane = document.createElement("div");
        pane.className = "pa-panel-section";
        pane.dataset.section = section.id;
        body.appendChild(pane);
        panes[section.id] = pane;
    });

    root.appendChild(tabBar);
    root.appendChild(body);

    /**
     * 切换分区（首次进入时懒加载内容）
     * @param {string} sectionId
     */
    function activate(sectionId) {
        const section = SECTIONS.find((item) => item.id === sectionId) || SECTIONS[0];

        Object.entries(panes).forEach(([id, pane]) => {
            pane.classList.toggle("active", id === section.id);
        });
        Object.entries(buttons).forEach(([id, button]) => {
            const active = id === section.id;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });

        const pane = panes[section.id];
        if (!pane) return;

        if (pane.dataset.mounted !== "1") {
            pane.dataset.mounted = "1";
            try {
                const result = section.mount(pane);
                if (result && typeof result.catch === "function") {
                    result.catch((error) => {
                        logger.error(`面板分区加载失败: ${section.id} | ${error.message}`);
                    });
                }
            } catch (error) {
                logger.error(`面板分区加载失败: ${section.id} | ${error.message}`);
            }
        }
    }

    function destroy() {
        // 目前各分区没有需要手动释放的全局监听；保留钩子便于以后扩展
        root.remove();
    }

    return { root, activate, destroy };
}

/**
 * 打开面板（可指定分区）
 * @param {string} [sectionId] api | rules | about
 */
export function openPanel(sectionId) {
    if (sectionId) {
        pendingSection = sectionId;
    }

    const sidebarTab = app.extensionManager?.sidebarTab;
    if (!sidebarTab) {
        logger.error("当前 ComfyUI 版本不支持 sidebarTab API");
        return;
    }

    if (sidebarTab.activeSidebarTabId !== PANEL_ID) {
        sidebarTab.toggleSidebarTab(PANEL_ID);
    }

    if (panelInstance) {
        panelInstance.activate(pendingSection);
    }
}

/**
 * 注册侧边栏面板（在扩展 setup 阶段调用一次）
 */
export function registerSidebarPanel() {
    setPanelOpener(openPanel);

    app.extensionManager.registerSidebarTab({
        id: PANEL_ID,
        icon: "pi pi-sparkles",
        title: tUI("提示词小助手"),
        tooltip: tUI("提示词小助手：API 配置与提示词规则"),
        type: "custom",
        render: (el) => {
            const built = buildPanel();
            el.appendChild(built.root);
            panelInstance = built;
            built.activate(pendingSection);

            return () => {
                panelInstance = null;
                built.destroy();
            };
        }
    });

    logger.log("提示词小助手侧边栏面板已注册");
}
