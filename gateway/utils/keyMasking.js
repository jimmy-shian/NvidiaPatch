function maskKeyValue(keyValue) {
  const value = String(keyValue || '');
  if (value.length <= 8) return '****';
  const suffix = value.substring(value.length - 8);
  return `nvapi-****...${suffix}`;
}

function maskKeyRow(k) {
  return {
    id: k.id,
    masked_key: maskKeyValue(k.key_value),
    key_suffix: k.key_value ? k.key_value.substring(k.key_value.length - 8) : '',
    status: k.status,
    cooldown_until: k.cooldown_until,
    consecutive_failures: k.consecutive_failures,
    total_errors: k.total_errors,
    last_used_at: k.last_used_at,
    last_error_message: k.last_error_message
  };
}

module.exports = {
  maskKeyValue,
  maskKeyRow
};
