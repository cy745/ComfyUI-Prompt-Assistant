/**
 * 侧边栏面板的数据层
 *
 * 只做 HTTP + 数据整形，不碰 DOM。
 * 所有接口与旧管理器保持一致，避免后端改动。
 */

import { APIService } from "../services/api.js";

const url = (path) => APIService.getApiUrl(path);

async function request(path, options = {}) {
    const response = await fetch(url(path), {
        headers: { "Content-Type": "application/json" },
        ...options
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (error) {
        throw new Error(`响应解析失败: ${text.slice(0, 120)}`);
    }
    if (!response.ok) {
        throw new Error((data && (data.error || data.detail)) || `${response.status} ${response.statusText}`);
    }
    return data;
}

/* ------------------------------------------------------------------ */
/* API 服务商                                                          */
/* ------------------------------------------------------------------ */

/** 角色定义：翻译 / 提示词优化 / 图像反推 */
export const ROLES = [
    { id: "translate", label: "翻译", endpoint: "/config/translate", serviceType: "translate", modelKey: "llm_models" },
    { id: "llm", label: "提示词优化", endpoint: "/config/llm", serviceType: "llm", modelKey: "llm_models" },
    { id: "vlm", label: "图像反推", endpoint: "/config/vision", serviceType: "vlm", modelKey: "vlm_models" }
];

export async function loadServices() {
    const data = await request("/services");
    return (data && data.services) || [];
}

export async function loadCurrentRoles() {
    const result = {};
    await Promise.all(
        ROLES.map(async (role) => {
            try {
                const data = await request(role.endpoint);
                result[role.id] = { provider: data.provider || null, model: data.model || null };
            } catch (error) {
                result[role.id] = { provider: null, model: null };
            }
        })
    );
    return result;
}

export async function setCurrentRole(roleId, serviceId) {
    const role = ROLES.find((item) => item.id === roleId);
    if (!role) throw new Error("未知角色");
    await request("/services/current", {
        method: "POST",
        body: JSON.stringify({ service_type: role.serviceType, service_id: serviceId })
    });
    window.dispatchEvent(new CustomEvent("pa-service-changed", { detail: { service_type: role.serviceType, service_id: serviceId } }));
}

export async function createService({ name, description = "" }) {
    return request("/services", {
        method: "POST",
        body: JSON.stringify({
            type: "openai_compatible",
            name,
            description,
            base_url: "https://api.example.com/v1",
            api_key: ""
        })
    });
}

export async function updateService(serviceId, patch) {
    return request(`/services/${serviceId}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function deleteService(serviceId) {
    return request(`/services/${serviceId}`, { method: "DELETE" });
}

export async function addModel(serviceId, modelType, modelName) {
    return request(`/services/${serviceId}/models`, {
        method: "POST",
        body: JSON.stringify({
            model_type: modelType,
            model_name: modelName,
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 4096
        })
    });
}

export async function deleteModel(serviceId, modelType, modelName) {
    return request(`/services/${serviceId}/models/${modelType}/${encodeURIComponent(modelName)}`, { method: "DELETE" });
}

export async function setDefaultModel(serviceId, modelType, modelName) {
    return request(`/services/${serviceId}/models/default`, {
        method: "PUT",
        body: JSON.stringify({ model_type: modelType, model_name: modelName })
    });
}

/** 服务商对某个角色可用的模型列表 */
export function modelsForRole(service, roleId) {
    const role = ROLES.find((item) => item.id === roleId);
    if (!role || !service) return [];
    if (role.id === "translate") {
        return (service.llm_models || []).map((model) => model.name);
    }
    return ((role.modelKey === "vlm_models" ? service.vlm_models : service.llm_models) || []).map((model) => model.name);
}

/* ------------------------------------------------------------------ */
/* 规则                                                                */
/* ------------------------------------------------------------------ */

/**
 * 规则分类
 * mapKey: 配置里的对象键；activeKey: active_prompts 里的键；match: 键前缀
 */
export const RULE_CATEGORIES = [
    { id: "expand", label: "提示词优化", mapKey: "expand_prompts", activeKey: "expand", match: "expand_" },
    { id: "zhVision", label: "中文反推", mapKey: "vision_prompts", activeKey: "vision_zh", match: "vision_zh_" },
    { id: "enVision", label: "英文反推", mapKey: "vision_prompts", activeKey: "vision_en", match: "vision_en_" },
    { id: "video", label: "视频反推", mapKey: "video_prompts", activeKey: "video", match: "video_" },
    { id: "translate", label: "翻译", mapKey: "translate_prompts", activeKey: null, match: "" }
];

export function categoryById(id) {
    return RULE_CATEGORIES.find((item) => item.id === id) || RULE_CATEGORIES[0];
}

/**
 * 读取规则配置
 * @returns {Promise<{raw: Object, active: Object}>}
 */
export async function loadRules() {
    const raw = await request("/config/system_prompts");
    return { raw: raw || {}, active: (raw && raw.active_prompts) || {} };
}

/** 把某个分类的规则整理成数组 */
export function listRules(raw, category) {
    const map = (raw && raw[category.mapKey]) || {};
    return Object.keys(map)
        .filter((key) => (category.match ? key.startsWith(category.match) : true))
        .map((key) => {
            const entry = map[key] || {};
            return {
                id: key,
                name: entry.name || key,
                content: entry.content || "",
                role: entry.role || "system",
                tags: entry.tags || [],
                category: entry.category || "",
                showIn: entry.showIn || ["frontend", "node"]
            };
        });
}

/** 某个分类当前激活的规则 id */
export function activeRuleId(active, category) {
    return category.activeKey ? active[category.activeKey] || null : null;
}

/**
 * 写回一条规则（新增或修改）
 * @param {Object} raw
 * @param {Object} category
 * @param {{id?: string, name: string, content: string}} rule
 * @returns {string} 规则 id
 */
export function writeRule(raw, category, rule) {
    if (!raw[category.mapKey]) raw[category.mapKey] = {};

    const isTranslate = category.id === "translate";
    const id = rule.id || (isTranslate ? rule.name : `${category.match}${rule.name}`);

    const previous = raw[category.mapKey][id] || {};
    raw[category.mapKey][id] = isTranslate
        ? { role: previous.role || "system", content: rule.content }
        : {
              name: rule.name,
              tags: previous.tags || [],
              category: previous.category || "",
              showIn: previous.showIn || ["frontend", "node"],
              role: "system",
              content: rule.content
          };

    return id;
}

/** 删除一条规则 */
export function removeRule(raw, category, ruleId) {
    if (raw[category.mapKey]) {
        delete raw[category.mapKey][ruleId];
    }
    if (raw.active_prompts && raw.active_prompts[category.activeKey] === ruleId) {
        const remaining = Object.keys(raw[category.mapKey] || {}).filter((key) =>
            category.match ? key.startsWith(category.match) : true
        );
        raw.active_prompts[category.activeKey] = remaining[0] || null;
    }
}

/** 设置某分类的默认规则 */
export function setActiveRule(raw, category, ruleId) {
    if (!raw.active_prompts) raw.active_prompts = {};
    if (category.activeKey) raw.active_prompts[category.activeKey] = ruleId;
}

/** 保存整份规则配置 */
export async function saveRules(raw) {
    await request("/config/system_prompts", { method: "POST", body: JSON.stringify(raw) });
}

/** 统计某分类规则数 */
export function countRules(raw, category) {
    return listRules(raw, category).length;
}
