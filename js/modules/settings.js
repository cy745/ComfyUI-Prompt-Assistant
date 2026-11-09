/**
 * 小助手设置服务
 * 负责管理小助手的设置选项，提供开关控制功能
 */

import { app } from "../../../../scripts/app.js";
import { logger } from '../utils/logger.js';
import { PromptAssistant } from "./PromptAssistant.js";
import { ImageCaption } from "./imageCaption.js";
import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
import { UIToolkit } from "../utils/UIToolkit.js";
import { FEATURES, handleFeatureChange } from "../services/features.js";
import { APIService } from "../services/api.js";
import {
    UI_LANGUAGE_SETTING_ID,
    getStoredUiLanguage,
    persistUiLanguage,
    ensureUiLocaleLoaded,
    tUI,
    patchToastLocalization,
    syncGlobalUiLocalization,
    LANGUAGE_OPTIONS
} from "../utils/uiI18n.js";

import { openPanel } from "./panelBridge.js";

// 标记是否是首次加载页面
let isFirstLoad = true;

function localizeSettingsPayload(payload) {
    if (Array.isArray(payload)) {
        return payload.map(item => localizeSettingsPayload(item));
    }

    if (!payload || typeof payload !== "object") {
        return payload;
    }

    const localized = {};
    for (const [key, value] of Object.entries(payload)) {
        if (key === "category" && Array.isArray(value)) {
            localized[key] = value.map(item => tUI(item, item));
            continue;
        }

        if (["name", "tooltip", "text", "summary", "detail"].includes(key) && typeof value === "string") {
            localized[key] = tUI(value, value);
            continue;
        }

        if (typeof value === "function") {
            localized[key] = value;
            continue;
        }

        localized[key] = localizeSettingsPayload(value);
    }

    return localized;
}

// ---服务选择器配置---
const SERVICE_TYPES = {
    translate: {
        name: tUI('翻译'),
        configEndpoint: '/config/translate',
        serviceType: 'translate',
        filterKey: 'llm_models',
        includeBaidu: true
    },
    llm: {
        name: tUI('提示词优化'),
        configEndpoint: '/config/llm',
        serviceType: 'llm',
        filterKey: 'llm_models',
        includeBaidu: false
    },
    vlm: {
        name: tUI('图像反推'),
        configEndpoint: '/config/vision',
        serviceType: 'vlm',
        filterKey: 'vlm_models',
        includeBaidu: false
    }
};

/**
 * 注册设置选项
 * 将设置选项添加到ComfyUI设置面板
 */

/**
 * 清理全部缓存（历史、标签、翻译、节点文档翻译）
 * Phase 1：原「清理所有缓存」自绘按钮改为命令入口，逻辑保持不变。
 */
export async function clearAllCaches() {    try {

                            try {
                                // 获取清理前的缓存统计
                                const beforeStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0,
                                    translate: TranslateCacheService.getTranslateCacheStats(),
                                    nodeHelpTranslate: 0 // 节点文档翻译缓存
                                };

                                // 统计所有标签数量
                                const tagCacheKeys = Object.keys(localStorage)
                                    .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX));

                                // 计算所有缓存中的标签总数
                                tagCacheKeys.forEach(key => {
                                    try {
                                        const cacheData = JSON.parse(localStorage.getItem(key));
                                        if (cacheData && typeof cacheData === 'object') {
                                            // 获取缓存中的标签数量
                                            const tagCount = Object.keys(cacheData).length;
                                            beforeStats.tags += tagCount;
                                        }
                                    } catch (e) {
                                        // 移除错误日志，静默处理解析错误
                                    }
                                });

                                // 统计节点文档翻译缓存数量
                                try {
                                    const nodeHelpCache = sessionStorage.getItem('pa_node_help_translations');
                                    if (nodeHelpCache) {
                                        const parsed = JSON.parse(nodeHelpCache);
                                        beforeStats.nodeHelpTranslate = Object.keys(parsed).length;
                                    }
                                } catch (e) {
                                    // 静默处理
                                }

                                // 执行历史记录清理操作
                                HistoryCacheService.clearAllHistory();

                                // 清理所有标签缓存
                                TagCacheService.clearAllTagCache();

                                // 清理翻译缓存
                                TranslateCacheService.clearAllTranslateCache();

                                // 清理节点文档翻译缓存（sessionStorage）
                                sessionStorage.removeItem('pa_node_help_translations');

                                // 清理旧版本的标签缓存（以PromptAssistant_tag_cache_开头的所有记录）
                                Object.keys(localStorage)
                                    .filter(key => key.startsWith('PromptAssistant_tag_cache_'))
                                    .forEach(key => localStorage.removeItem(key));

                                // 清除1.0.3以前版本遗留的三项配置信息，避免泄露
                                localStorage.removeItem("PromptAssistant_Settings_llm_api_key");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_secret");
                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_appid");

                                // 获取清理后的缓存统计
                                const afterStats = {
                                    history: HistoryCacheService.getHistoryStats(),
                                    tags: 0, // 清理后标签数应该为0
                                    translate: TranslateCacheService.getTranslateCacheStats()
                                };

                                // 计算清理数量
                                const clearedHistory = beforeStats.history.total - afterStats.history.total;
                                const clearedTags = beforeStats.tags;
                                const clearedTranslate = beforeStats.translate.total - afterStats.translate.total;
                                const clearedNodeHelp = beforeStats.nodeHelpTranslate;

                                // 只输出最终统计结果
                                logger.log(`缓存清理完成 | 历史记录: ${clearedHistory}条 | 标签: ${clearedTags}个 | 翻译: ${clearedTranslate}条 | 节点文档: ${clearedNodeHelp}个`);

                                // 更新所有实例的撤销/重做按钮状态
                                PromptAssistant.instances.forEach((instance) => {
                                    if (instance && instance.nodeId && instance.inputId) {
                                        UIToolkit.updateUndoRedoButtonState(instance, HistoryCacheService);
                                    }
                                });

                            } catch (error) {
                                // 简化错误日志
                                logger.error(`缓存清理失败`);
                                throw error;
                            }
        app.extensionManager.toast.add({
            severity: "success",
            summary: tUI("缓存已清理"),
            life: 3000
        });
    } catch (error) {
        logger.error(`缓存清理失败: ${error.message}`);
        app.extensionManager.toast.add({
            severity: "error",
            summary: tUI("缓存清理失败"),
            detail: error.message,
            life: 4000
        });
    }
}
export async function registerSettings() {
    try {
        await ensureUiLocaleLoaded();
        patchToastLocalization();
        syncGlobalUiLocalization();

        app.registerExtension({
            name: "PromptAssistant.Settings",

            settings: localizeSettingsPayload([
                {
                    id: UI_LANGUAGE_SETTING_ID,
                    name: "界面语言",
                    category: ["✨提示词小助手", "系统", "界面语言"],
                    type: "combo",
                    options: LANGUAGE_OPTIONS,
                    defaultValue: "zh",
                    tooltip: "切换插件界面语言，修改后自动刷新页面生效",
                    onChange: (value) => {
                        const previous = getStoredUiLanguage();
                        const normalized = persistUiLanguage(value);
                        if (normalized === previous) return;
                        logger.log(`界面语言已切换: ${normalized}`);
                        setTimeout(() => window.location.reload(), 80);
                    }
                },
                // 总开关 - 独立控制小助手系统级功能
                {
                    id: "PromptAssistant.Features.Enabled",
                    name: "启用小助手",
                    category: ["✨提示词小助手", "小助手功能开关", "总开关"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "关闭后，提示词小助手所有功能将禁用",
                    onChange: async (value) => {
                        try {
                            // 获取当前状态，用于判断是否是初始化
                            const currentState = window.FEATURES.enabled;

                            // 只有状态真正变化时才输出日志
                            if (currentState !== value) {
                                logger.log(`总开关状态变更 | 状态:${value ? "启用" : "禁用"}`);
                            } else {
                                // 如果状态没有变化，使用调试级别日志
                                logger.debug(`总开关状态保持不变 | 状态:${value ? "启用" : "禁用"}`);
                            }

                            // 更新全局状态
                            window.FEATURES.enabled = value;

                            // 从全局 app 对象获取 promptAssistant 实例
                            const promptAssistantInstance = app.promptAssistant;
                            const imageCaptionInstance = app.imageCaption;

                            if (!promptAssistantInstance) {
                                logger.error("总开关切换失败 | 错误:未找到PromptAssistant实例");
                                return;
                            }

                            // 根据开关状态执行相应操作
                            if (value) {
                                // 启用功能
                                await promptAssistantInstance.toggleGlobalFeature(true, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(true, currentState !== value);
                                }

                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
                                if (currentState !== value) {
                                    logger.debug("功能启用完成");
                                    // 只在状态发生变化且不是首次加载时显示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "info",
                                            summary: tUI("提示词小助手已启用"),
                                            life: 3000
                                        });
                                    }
                                }
                            } else {
                                // 禁用功能
                                await promptAssistantInstance.toggleGlobalFeature(false, currentState !== value);
                                if (imageCaptionInstance) {
                                    await imageCaptionInstance.toggleGlobalFeature(false, currentState !== value);
                                }

                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
                                if (currentState !== value) {
                                    logger.debug("功能禁用完成");
                                    // 只在状态发生变化且不是首次加载时显示提示
                                    if (!isFirstLoad) {
                                        app.extensionManager.toast.add({
                                            severity: "warn",
                                            summary: tUI("提示词小助手已禁用"),
                                            life: 3000
                                        });
                                    }
                                }
                            }

                            // 设置首次加载标志为 false，表示已经完成首次加载
                            isFirstLoad = false;
                        } catch (error) {
                            logger.error(`总开关切换异常 | 错误:${error.message}`);
                        }
                    }
                },

                // 小助手创建方式设置
                {
                    id: "PromptAssistant.Settings.CreationMode",
                    name: "小助手创建方式（提示词）",
                    category: ["✨提示词小助手", "系统", "提示词小助手创建方式"],
                    type: "combo",
                    options: [
                        { text: "自动创建", value: "auto" },
                        { text: "选中节点时创建", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "自动创建：节点创建或加载时自动显示小助手；选中节点时创建：仅选中节点时显示",
                    onChange: (value) => {
                        logger.log(`小助手创建方式变更 | 模式:${value === 'auto' ? '自动创建' : '选中节点时创建'}`);
                        // 如果切换到自动创建，立即尝试初始化所有节点
                        if (value === 'auto' && window.FEATURES.enabled && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._promptAssistantInitialized) {
                                    app.promptAssistant.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // 反推小助手创建方式设置
                {
                    id: "PromptAssistant.Settings.ImageCaptionCreationMode",
                    name: "小助手创建方式（图像反推）",
                    category: ["✨提示词小助手", "系统", "图像小助手创建方式"],
                    type: "combo",
                    options: [
                        { text: "自动创建", value: "auto" },
                        { text: "选中节点时创建", value: "manual" }
                    ],
                    defaultValue: "auto",
                    tooltip: "自动创建：节点创建或加载时自动显示反推小助手；选中节点时创建：仅选中节点时显示",
                    onChange: (value) => {
                        logger.log(`反推小助手创建方式变更 | 模式:${value === 'auto' ? '自动创建' : '选中节点时创建'}`);
                        // 如果切换到自动创建，立即尝试初始化所有节点
                        if (value === 'auto' && window.FEATURES.enabled && window.FEATURES.imageCaption && app.graph) {
                            const nodes = app.graph._nodes || [];
                            nodes.forEach(node => {
                                if (node && !node._imageCaptionInitialized) {
                                    app.imageCaption.checkAndSetupNode(node);
                                }
                            });
                        }
                    }
                },

                // 小助手布局（提示词）
                {
                    id: "PromptAssistant.Location",
                    name: "小助手布局（提示词）",
                    category: ["✨提示词小助手", "界面", "提示词小助手布局"],
                    type: "combo",
                    options: [
                        // { text: "左上（横向）", value: "top-left-h" },
                        // { text: "左上（垂直）", value: "top-left-v" },
                        // { text: "中上（横向）", value: "top-center-h" },
                        // { text: "⇗ ━", value: "top-right-h" },
                        // { text: "⇗ ┃", value: "top-right-v" },
                        { text: "右中（垂直）", value: "right-center-v" },
                        { text: "右下（横向）", value: "bottom-right-h" },
                        { text: "右下（垂直）", value: "bottom-right-v" },
                        { text: "下中（横向）", value: "bottom-center-h" },
                        { text: "左下（横向）", value: "bottom-left-h" },
                        // { text: "左下（垂直）", value: "bottom-left-v" },
                        // { text: "左中（垂直）", value: "left-center-v" }
                    ],
                    defaultValue: "bottom-right-h", // 默认右下横向
                    tooltip: "设置提示词小助手在输入框周围的布局和展开方向",
                    onChange: (value) => {
                        logger.log(`提示词小助手布局变更 | 布局:${value}`);
                        // 通知所有实例更新布局（通过 CSS 类处理）
                        PromptAssistant.instances.forEach(widget => {
                            if (widget.container && widget.container.setAnchorPosition) {
                                widget.container.setAnchorPosition(value);
                            }
                        });
                    }
                },
                // 小助手位置设置（图像反推）
                {
                    id: "ImageCaption.Location",
                    name: "小助手布局（图像反推）",
                    category: ["✨提示词小助手", "界面", "图像小助手布局"],
                    type: "combo",
                    options: [
                        { text: "横", value: "bottom-left-h" },
                        { text: "竖", value: "bottom-left-v" }
                    ],
                    defaultValue: "bottom-left-h", // 默认横向
                    tooltip: "设置图像反推小助手的展开方向（位置固定在左下角）",
                    onChange: (value) => {
                        logger.log(`图像反推小助手布局变更 | 布局:${value}`);
                        // 通知所有实例更新布局
                        ImageCaption.instances.forEach(assistant => {
                            if (assistant.container && assistant.container.setAnchorPosition) {
                                assistant.container.setAnchorPosition(value);
                            }
                        });
                    },
                },

                // 历史功能（包含历史、撤销、重做按钮）
                {
                    id: "PromptAssistant.Features.History",
                    name: "启用历史功能",
                    category: ["✨提示词小助手", "小助手功能开关", "历史功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭历史、撤销、重做功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.history;
                        FEATURES.history = value;
                        handleFeatureChange('历史功能', value, oldValue);
                        logger.log(`历史功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 标签工具
                {
                    id: "PromptAssistant.Features.Tag",
                    name: "启用标签工具",
                    category: ["✨提示词小助手", "小助手功能开关", "标签功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭标签工具功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.tag;
                        FEATURES.tag = value;
                        handleFeatureChange('标签工具', value, oldValue);
                        logger.log(`标签工具 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 扩写功能
                {
                    id: "PromptAssistant.Features.Expand",
                    name: "启用提示词优化功能",
                    category: ["✨提示词小助手", "小助手功能开关", "提示词优化功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭提示词优化功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.expand;
                        FEATURES.expand = value;
                        handleFeatureChange('提示词优化功能', value, oldValue);
                        logger.log(`提示词优化功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 翻译功能
                {
                    id: "PromptAssistant.Features.Translate",
                    name: "启用翻译功能",
                    category: ["✨提示词小助手", "小助手功能开关", "翻译功能"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭翻译功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.translate;
                        FEATURES.translate = value;
                        handleFeatureChange('翻译功能', value, oldValue);
                        logger.log(`翻译功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 使用翻译缓存功能
                {
                    id: "PromptAssistant.Features.UseTranslateCache",
                    name: "使用翻译缓存",
                    category: ["✨提示词小助手", " 翻译功能设置", "翻译缓存"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启后，如果翻译内容翻译过，则使用历史翻译结果，避免相同内容重复翻译改变原意。如果需要重新翻译，请随便加一个空格即可跳过缓存。",
                    onChange: (value) => {
                        const oldValue = FEATURES.useTranslateCache;
                        FEATURES.useTranslateCache = value;
                        logger.log(`使用翻译缓存 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 混合语言缓存选项
                {
                    id: "PromptAssistant.Features.CacheMixedLangTranslation",
                    name: "混合语言翻译进行缓存",
                    category: ["✨提示词小助手", " 翻译功能设置", "混合语言缓存"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "关闭时，中英文混合内容的翻译结果不会写入缓存，避免污染缓存。开启后会正常缓存。",
                    onChange: (value) => {
                        FEATURES.cacheMixedLangTranslation = value;
                        logger.log(`混合语言缓存 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 混合语言翻译规则
                {
                    id: "PromptAssistant.Features.MixedLangTranslateRule",
                    name: "混合语言翻译规则",
                    category: ["✨提示词小助手", " 翻译功能设置", "混合语言规则"],
                    type: "combo",
                    options: [
                        { text: "翻译成英文", value: "to_en" },
                        { text: "翻译成中文", value: "to_zh" },
                        { text: "自动翻译小比例语言", value: "auto_minor" },
                        { text: "自动翻译大比例语言", value: "auto_major" }
                    ],
                    defaultValue: "to_en",
                    tooltip: "根据个人使用偏好设置混合中英文内容的翻译规则",
                    onChange: (value) => {
                        FEATURES.mixedLangTranslateRule = value;
                        logger.log(`混合语言翻译规则 - 已设置为:${value}`);
                    }
                },

                // 翻译格式化选项
                {
                    id: "PromptAssistant.Features.TranslateFormatPunctuation",
                    name: "始终使用半角标点符号",
                    category: ["✨提示词小助手", " 翻译功能设置", "标点处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会自动将中文标点符号替换成英文标点符号",
                    onChange: (value) => {
                        FEATURES.translateFormatPunctuation = value;
                        logger.log(`标点符号转换 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatSpace",
                    name: "自动移除多余空格",
                    category: ["✨提示词小助手", " 翻译功能设置", "空格处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会自动移除多余空格",
                    onChange: (value) => {
                        FEATURES.translateFormatSpace = value;
                        logger.log(`移除多余空格 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatDots",
                    name: "移除多余连续点号",
                    category: ["✨提示词小助手", " 翻译功能设置", "点号处理"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "打开后，翻译结果会将多余的“......”统一为“...”",
                    onChange: (value) => {
                        FEATURES.translateFormatDots = value;
                        logger.log(`处理连续点号 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                {
                    id: "PromptAssistant.Features.TranslateFormatNewline",
                    name: "保留换行符",
                    category: ["✨提示词小助手", " 翻译功能设置", "换行处理"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "打开后，翻译结果会尽量保持原文的换行，避免翻译后丢失段落",
                    onChange: (value) => {
                        FEATURES.translateFormatNewline = value;
                        logger.log(`保留换行符 - 已${value ? "启用" : "禁用"}`);
                    }
                },



                // 图像反推功能
                {
                    id: "PromptAssistant.Features.ImageCaption",
                    name: "启用图像反推功能",
                    category: ["✨提示词小助手", "小助手功能开关", "图像反推"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭图像反推提示词功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.imageCaption;
                        FEATURES.imageCaption = value;
                        handleFeatureChange('图像反推', value, oldValue);
                        logger.log(`图像反推功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 节点帮助翻译功能
                {
                    id: "PromptAssistant.Features.NodeHelpTranslator",
                    name: "启用节点信息翻译",
                    category: ["✨提示词小助手", "小助手功能开关", "节点信息翻译"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启或关闭ComfyUI侧边栏节点帮助文档的翻译功能",
                    onChange: (value) => {
                        const oldValue = FEATURES.nodeHelpTranslator;
                        FEATURES.nodeHelpTranslator = value;
                        handleFeatureChange('节点信息翻译', value, oldValue);
                        logger.log(`节点信息翻译功能 - 已${value ? "启用" : "禁用"}`);
                    }
                },
                // 系统设置
                {
                    id: "PromptAssistant.Settings.LogLevel",
                    name: "日志级别",
                    category: ["✨提示词小助手", "系统", "日志级别"],
                    type: "hidden",
                    defaultValue: "0",
                    options: [
                        { text: "错误日志", value: "0" },
                        { text: "基础日志", value: "1" },
                        { text: "详细日志", value: "2" }
                    ],
                    tooltip: "设置日志输出级别：错误日志(仅错误)、基础日志(错误+基础信息)、详细日志(错误+基础信息+调试信息)",
                    onChange: (value) => {
                        const oldValue = window.FEATURES.logLevel;
                        window.FEATURES.logLevel = parseInt(value);
                        logger.setLevel(window.FEATURES.logLevel);
                        logger.log(`日志级别已更新 | 原级别:${oldValue} | 新级别:${value}`);
                    }
                },

                // 显示流式输出进度
                {
                    id: "PromptAssistant.Settings.ShowStreamingProgress",
                    name: "控制台流式输出进度日志",
                    category: ["✨提示词小助手", "系统", "终端日志"],
                    type: "boolean",
                    defaultValue: false,
                    tooltip: "开启后，控制台会显示流式输出过程，在某些终端可能导致刷屏；关闭后只显示静态的'生成中...'。",
                    onChange: async (value) => {
                        FEATURES.showStreamingProgress = value;
                        // 通知后端更新设置
                        try {
                            await fetch(APIService.getApiUrl('/settings/streaming_progress'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ enabled: value })
                            });
                        } catch (error) {
                            logger.error(`更新流式进度设置失败: ${error.message}`);
                        }
                        logger.log(`流式输出进度 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                // 流式输出开关
                {
                    id: "PromptAssistant.Settings.EnableStreaming",
                    name: "流式输出开关",
                    category: ["✨提示词小助手", "系统", "流式体验"],
                    type: "boolean",
                    defaultValue: true,
                    tooltip: "开启时，翻译、扩写、识别等功能将以逐字生成的流式效果显示；关闭时则恢复为全部生成后一次性显示的阻塞模式。",
                    onChange: (value) => {
                        FEATURES.enableStreaming = value;
                        logger.log(`流式输出开关 - 已${value ? "启用" : "禁用"}`);
                    }
                },

                {
                    id: "PromptAssistant.Settings.IconOpacity",
                    name: " 小助手图标不透明度",
                    category: ["✨提示词小助手", "界面", "小助手图标"],
                    type: "slider",
                    min: 0,
                    max: 100,
                    step: 1,
                    defaultValue: 20,
                    tooltip: "设置折叠后小助手图标的不透明度",
                    onChange: (value) => {
                        // 将0-100的值转换为0-1的透明度
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.log(`小助手图标不透明度已更新 | 值:${value}% | 透明度:${opacity}`);
                    },
                    onLoad: (value) => {
                        // 初始化时应用默认值
                        const opacity = value * 0.01;
                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
                        logger.debug(`小助手图标不透明度初始化 | 值:${value}% | 透明度:${opacity}`);
                    }
                },

            ])
        });

        logger.log("小助手设置注册成功");
        return true;
    } catch (error) {
        logger.error(`小助手设置注册失败: ${error.message}`);
        return false;
    }
}
