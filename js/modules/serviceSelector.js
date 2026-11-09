/**
 * 服务选择器（侧边栏面板内使用）
 *
 * 原实现位于 settings.js 的自定义设置行里，依赖未文档化的函数 type；
 * Phase 1/2 重构后设置页不再自绘，服务选择器迁到侧边栏面板中复用。
 */

import { logger } from '../utils/logger.js';
import { APIService } from '../services/api.js';
import { tUI } from '../utils/uiI18n.js';
import { createSelectGroup } from './uiComponents.js';

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

// ---服务选择器---
const serviceSelector = {
    _servicesCache: null,
    _cacheTime: 0,
    _cacheDuration: 2000, // 缓存2秒

    /**
     * 清除服务缓存
     */
    clearCache() {
        this._servicesCache = null;
        this._cacheTime = 0;
        logger.debug('服务列表缓存已清除');
    },

    // 获取服务列表（带缓存）
    async getServices(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this._servicesCache && (now - this._cacheTime) < this._cacheDuration) {
            return this._servicesCache;
        }

        try {
            const response = await fetch(APIService.getApiUrl('/services'));
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this._servicesCache = data.services || [];
                    this._cacheTime = now;
                    return this._servicesCache;
                }
            }
        } catch (error) {
            logger.error(`获取服务列表失败: ${error.message}`);
        }
        return [];
    },

    // 获取指定类型的当前服务ID
    async getCurrentService(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return null;

        try {
            const response = await fetch(APIService.getApiUrl(config.configEndpoint));
            if (response.ok) {
                const data = await response.json();
                return data.provider || null;
            }
        } catch (error) {
            logger.error(`获取${config.name}当前服务失败: ${error.message}`);
        }
        return null;
    },

    // 设置指定类型的服务
    async setCurrentService(type, serviceId) {
        const config = SERVICE_TYPES[type];
        if (!config) return false;

        try {
            const response = await fetch(APIService.getApiUrl('/services/current'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: config.serviceType,
                    service_id: serviceId
                })
            });

            if (response.ok) {
                logger.log(`${config.name}服务切换 | 服务ID: ${serviceId}`);

                // 派发全局事件通知其他组件同步
                window.dispatchEvent(new CustomEvent('pa-service-changed', {
                    detail: { service_type: config.serviceType, service_id: serviceId }
                }));

                return true;
            }
        } catch (error) {
            logger.error(`切换${config.name}服务失败: ${error.message}`);
        }
        return false;
    },

    // 获取指定类型可用的服务选项列表
    async getServiceOptions(type) {
        const config = SERVICE_TYPES[type];
        if (!config) return [];

        const services = await this.getServices();
        const options = [];

        // 添加百度翻译选项（仅翻译类型）
        if (config.includeBaidu) {
            options.push({ value: 'baidu', text: tUI('百度翻译') });
        }

        // 过滤并添加其他服务
        services
            .filter(service => {
                const models = service[config.filterKey];
                return models && models.length > 0;
            })
            .forEach(service => {
                options.push({
                    value: service.id,
                    text: service.name || service.id
                });
            });

        return options;
    }
};

// 将服务选择器挂载到全局 app 对象，方便其他模块（如 PromptAssistant.js, imageCaption.js）调用，
// 同时避免模块间的循环引用问题。

// ---版本检查工具函数---

// 版本检查状态缓存
let versionCheckCache = {
    checked: false,        // 是否已检查过
    latestVersion: null,   // 最新版本号
    hasUpdate: false       // 是否有更新
};

/**
 * 从 jsDelivr 获取最新版本号（通过读取 pyproject.toml）
 * @returns {Promise<string|null>} 返回最新版本号，格式如 "1.2.3"，失败返回 null
 */
async function fetchLatestVersion() {
    // 如果已经检查过，直接返回缓存结果
    if (versionCheckCache.checked) {
        return versionCheckCache.latestVersion;
    }

    try {
        const response = await fetch('https://cdn.jsdelivr.net/gh/yawiii/ComfyUI-Prompt-Assistant@main/pyproject.toml', {
            cache: 'no-cache'
        });

        if (!response.ok) {
            logger.warn(`[版本检查] 请求失败: ${response.status}`);
            versionCheckCache.checked = true;
            return null;
        }

        const tomlContent = await response.text();
        const versionMatch = tomlContent.match(/^version\s*=\s*["']([^"']+)["']/m);
        const version = versionMatch ? versionMatch[1] : null;

        // 缓存检查结果
        versionCheckCache.checked = true;
        versionCheckCache.latestVersion = version;

        return version;
    } catch (error) {
        logger.warn(`[版本检查] 获取失败: ${error.message}`);
        versionCheckCache.checked = true;
        return null;
    }
}

/**
 * 比较两个版本号
 * @param {string} v1 - 第一个版本号
 * @param {string} v2 - 第二个版本号
 * @returns {number} v1 > v2 返回 1，v1 < v2 返回 -1，v1 === v2 返回 0
 */
function compareVersion(v1, v2) {
    // 将版本号分割为数字数组
    const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);

    // 确保两个数组长度相同
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}


/**
 * 创建服务选择器下拉框
 * @param {string} type - 服务类型: 'translate' | 'llm' | 'vlm'
 * @param {string} label - 显示名称
 * @returns {HTMLElement} 设置行元素
 */
function createServiceSelector(type, label) {
    // 创建加载占位容器
    const container = document.createElement("div");
    container.style.minWidth = "180px";
    container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("加载中...")}</span>`;

    let currentOptions = []; // 存储当前选项引用
    let updateDropdownOptions = null; // 存储更新函数

    /**
     * 更新下拉框内容
     * @param {boolean} force - 是否强制刷新数据
     */
    const updateContent = async (force = false) => {
        try {
            if (force) {
                // 如果是强制刷新（如配置变更或点击触发），先清除缓存
                serviceSelector.clearCache();
            }

            // 获取服务列表和当前选中的服务
            const [options, currentService] = await Promise.all([
                serviceSelector.getServiceOptions(type),
                serviceSelector.getCurrentService(type)
            ]);

            // 如果已经存在下拉框实例，则尝试增量更新
            if (updateDropdownOptions) {
                updateDropdownOptions(options, currentService);
                currentOptions = options;
                return;
            }

            // ---首次加载逻辑---
            container.innerHTML = '';

            if (options.length === 0) {
                container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("暂无可用服务")}</span>`;
                return;
            }

            currentOptions = options;
            const res = createSelectGroup(label, options, currentService, { showLabel: false });
            const { group, select } = res;
            updateDropdownOptions = res.updateOptions;

            // 将 group 的子元素添加到容器
            while (group.firstChild) {
                container.appendChild(group.firstChild);
            }

            // 监听点击/按下事件：当用户准备点击下拉框时，尝试静默同步最新配置
            const dropdownContainer = container.querySelector('.pa-dropdown');
            if (dropdownContainer) {
                dropdownContainer.addEventListener('mousedown', () => {
                    // 点击时触发刷新，但不显示“同步中”以避免干扰 UI
                    updateContent(true);
                });
            }

            // 监听变更事件
            select.addEventListener('change', async () => {
                const newValue = select.value;
                if (!newValue) return;

                const dropdown = container.querySelector('.pa-dropdown');
                if (dropdown) {
                    dropdown.style.opacity = '0.6';
                    dropdown.style.pointerEvents = 'none';
                }

                try {
                    const success = await serviceSelector.setCurrentService(type, newValue);
                    if (success) {
                        logger.log(`设置${label}服务 | 服务: ${newValue}`);
                    } else {
                        logger.error(`设置${label}服务失败`);
                        const oldValue = await serviceSelector.getCurrentService(type);
                        if (oldValue && updateDropdownOptions) {
                            updateDropdownOptions(currentOptions, oldValue);
                        }
                    }
                } catch (error) {
                    logger.error(`设置${label}服务异常: ${error.message}`);
                } finally {
                    if (dropdown) {
                        dropdown.style.opacity = '';
                        dropdown.style.pointerEvents = '';
                    }
                }
            });

        } catch (error) {
            logger.error(`同步${label}配置失败: ${error.message}`);
            if (!updateDropdownOptions) {
                container.innerHTML = `<span style="color: var(--p-red-400); font-size: 12px;">${tUI("加载失败")}</span>`;
            }
        }
    };

    // 初始加载
    updateContent();

    // 监听配置更新事件（当 API 配置管理器修改配置后触发）
    const onConfigUpdated = () => {
        logger.debug(`收到配置更新通知，同步${label}状态...`);
        updateContent(true);
    };
    window.addEventListener('pa-config-updated', onConfigUpdated);

    // 销毁监听器的清理函数（简单处理，因为设置面板通常随页面销毁）
    // 如果之后有更复杂的组件挂载逻辑，可以在这里返回一个清理函数给外部调用

    return container;
}

export { createServiceSelector };

