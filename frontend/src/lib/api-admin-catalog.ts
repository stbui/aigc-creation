import { request, toQuery } from "./api";
import { formDataWithFile } from "./http";

import type {
  AdminPrompt,
  AdminPromptListResult,
  CreatePromptPayload,
  PromptUploadedImage,
  UpdatePromptPayload,
} from "../types/admin-prompts";
import type {
  AdminTemplateCatalog,
  AdminTemplateCategory,
  AdminTemplateGroup,
  AdminTemplateItem,
} from "../types/api";

/**
 * 写真模板目录（/admin/templates）。
 *
 * 三级结构：一级分类（来源文章/主题）→ 二级分类（风格/场景）→ 模板（图 + 提示词 + 标签）。
 * 图片上传只返回稳定引用与预览地址，条目保存时再把引用写入 `imageUrl`。
 */
export const adminTemplateCatalogApi = {
  catalog: () => request<AdminTemplateCatalog>("/admin/templates/catalog"),

  createCategory: (payload: {
    slug: string;
    name: string;
    sourceUrl?: string;
    description?: string;
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateCategory>("/admin/templates/categories", { method: "POST", body: payload }),

  updateCategory: (
    id: string,
    payload: Partial<{
      slug: string;
      name: string;
      sourceUrl: string;
      description: string;
      sortOrder: number;
      enabled: boolean;
    }>,
  ) => request<AdminTemplateCategory>(`/admin/templates/categories/${id}`, { method: "PATCH", body: payload }),

  removeCategory: (id: string) =>
    request<{ id: string; name: string; removedGroups: number; removedItems: number }>(
      `/admin/templates/categories/${id}`,
      { method: "DELETE" },
    ),

  createGroup: (payload: {
    categoryId: string;
    slug: string;
    name: string;
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateGroup>("/admin/templates/groups", { method: "POST", body: payload }),

  updateGroup: (
    id: string,
    payload: Partial<{ slug: string; name: string; sortOrder: number; enabled: boolean }>,
  ) => request<AdminTemplateGroup>(`/admin/templates/groups/${id}`, { method: "PATCH", body: payload }),

  removeGroup: (id: string) =>
    request<{ id: string; name: string; removedItems: number }>(`/admin/templates/groups/${id}`, {
      method: "DELETE",
    }),

  createItem: (payload: {
    groupId: string;
    name: string;
    prompt: string;
    imageUrl: string;
    tags?: string[];
    sortOrder?: number;
    enabled?: boolean;
  }) => request<AdminTemplateItem>("/admin/templates/items", { method: "POST", body: payload }),

  updateItem: (
    id: string,
    payload: Partial<{
      name: string;
      prompt: string;
      imageUrl: string;
      tags: string[];
      sortOrder: number;
      enabled: boolean;
    }>,
  ) => request<AdminTemplateItem>(`/admin/templates/items/${id}`, { method: "PATCH", body: payload }),

  removeItem: (id: string) =>
    request<{ id: string; name: string }>(`/admin/templates/items/${id}`, { method: "DELETE" }),

  uploadImage: (file: File) =>
    request<{ imageUrl: string; previewUrl: string; width: number; height: number; sizeBytes: number }>(
      "/admin/templates/upload",
      { method: "POST", body: formDataWithFile("file", file) },
    ),
};

/**
 * 提示词库（/admin/prompts）。
 *
 * 列表是服务端分页；`categories` 随列表一起下发，供筛选下拉使用。
 * 删除为物理删除，C 端暂未接入，因此没有引用保护。
 */
export const adminPromptsApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      category?: string;
      modality?: string;
      enabled?: boolean;
      sort?: string;
    } = {},
  ) => request<AdminPromptListResult>(`/admin/prompts${toQuery(params)}`),

  detail: (id: string) => request<AdminPrompt>(`/admin/prompts/${id}`),

  create: (payload: CreatePromptPayload) =>
    request<AdminPrompt>("/admin/prompts", { method: "POST", body: payload }),

  update: (id: string, payload: UpdatePromptPayload) =>
    request<AdminPrompt>(`/admin/prompts/${id}`, { method: "PATCH", body: payload }),

  remove: (id: string) =>
    request<{ id: string; title: string }>(`/admin/prompts/${id}`, { method: "DELETE" }),

  /** 批量上传配图，字段名 `files`，最多 9 张。返回稳定引用与预览地址。 */
  uploadImages: (files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    return request<{ items: PromptUploadedImage[] }>("/admin/prompts/upload", {
      method: "POST",
      body,
    });
  },
};
