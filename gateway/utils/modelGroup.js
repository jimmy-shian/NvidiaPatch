const { modelsConfig } = require('../../database');

function parseModelGroupValue(value) {
  if (value === undefined || value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^[123]$/.test(raw)) {
    return Number(raw);
  }

  const normalized = raw.toLowerCase();

  const exactMatch = normalized.match(/^(?:group|model-group|model_group|modelgroup|g)[\s:_=-]*([123])$/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const prefixMatch = normalized.match(/^(?:group|model-group|model_group|modelgroup|g)[\s:_=-]*([123])(?:[\s,;|:/-].*)$/);
  if (prefixMatch) {
    return Number(prefixMatch[1]);
  }

  return null;
}

function getBearerTokenFromRequest(req) {
  const authorization = req.headers.authorization || '';
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resolveModelGroupFromRequest(req) {
  const headerGroup = parseModelGroupValue(req.headers['x-model-group'])
    || parseModelGroupValue(req.headers['x-gateway-model-group']);

  if (headerGroup) {
    return {
      groupId: headerGroup,
      fromClientKey: true,
      source: 'header'
    };
  }

  const queryGroup = parseModelGroupValue(req.query && (req.query.groupId || req.query.modelGroup || req.query.group));
  if (queryGroup) {
    return {
      groupId: queryGroup,
      fromClientKey: true,
      source: 'query'
    };
  }

  const bearerGroup = parseModelGroupValue(getBearerTokenFromRequest(req));
  if (bearerGroup) {
    return {
      groupId: bearerGroup,
      fromClientKey: true,
      source: 'api-key'
    };
  }

  return {
    groupId: modelsConfig.getActiveGroup(),
    fromClientKey: false,
    source: 'active-group'
  };
}

function buildOpenAiModelsListForGroup(groupId) {
  const configuredModels = modelsConfig.getAll(groupId).filter(m => m.is_active === 1);
  const modelsData = [
    {
      id: 'patcher-main',
      object: 'model',
      created: 1718925400,
      owned_by: `gateway-group-${groupId}`
    }
  ];

  configuredModels.forEach(m => {
    if (m.model_id !== 'patcher-main') {
      modelsData.push({
        id: m.model_id,
        object: 'model',
        created: 1718925400,
        owned_by: 'nvidia'
      });
    }
  });

  return {
    object: 'list',
    data: modelsData,
    gateway_model_group: groupId
  };
}

module.exports = {
  parseModelGroupValue,
  getBearerTokenFromRequest,
  resolveModelGroupFromRequest,
  buildOpenAiModelsListForGroup
};
