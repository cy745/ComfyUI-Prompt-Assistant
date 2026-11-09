/**
 * 侧边栏面板桥接
 *
 * 管理器（apiConfigManager / rulesConfigManager）和设置模块需要「打开面板」，
 * 但面板本身又依赖这些管理器；用一个极小的桥接模块打破循环依赖。
 */

let panelOpener = null;

/**
 * 注册面板打开函数（由 sidebarPanel 在初始化时调用）
 * @param {Function} opener (sectionId?: string) => void
 */
export function setPanelOpener(opener) {
    panelOpener = typeof opener === "function" ? opener : null;
}

/**
 * 打开提示词小助手侧边栏面板
 * @param {string} [sectionId] 目标分区：api | rules | about
 */
export function openPanel(sectionId) {
    if (!panelOpener) {
        console.warn("[PromptAssistant] 面板尚未注册，无法打开", sectionId);
        return;
    }
    try {
        panelOpener(sectionId);
    } catch (error) {
        console.error("[PromptAssistant] 打开面板失败", error);
    }
}
