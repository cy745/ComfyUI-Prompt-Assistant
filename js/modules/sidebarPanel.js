/**
 * 兼容入口：侧边栏面板实现在 ../panel/app.js
 *
 * 保留这个文件，避免 index.js / 旧代码的 import 路径失效。
 */
export { PANEL_ID, openPanel, registerSidebarPanel } from "../panel/app.js";
