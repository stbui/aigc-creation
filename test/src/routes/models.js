import { modelIdsOf } from '../config.js';
import { notFound } from '../errors.js';
import { sendJson } from '../http.js';

const CREATED_AT = 1_760_000_000; // 固定时间，保证响应可复现

function modelObject(id) {
  return {
    id,
    object: 'model',
    created: CREATED_AT,
    owned_by: 'mock-model-gateway',
  };
}

export function handleModels(ctx) {
  const ids = modelIdsOf(ctx.cfg);
  sendJson(ctx.req, ctx.res, 200, {
    object: 'list',
    data: ids.map(modelObject),
  });
}

export function handleModel(ctx, id) {
  const ids = modelIdsOf(ctx.cfg);
  if (!ids.includes(id)) throw notFound(`模型 "${id}" 不存在`);
  sendJson(ctx.req, ctx.res, 200, modelObject(id));
}
