<<<<<<< SEARCH [PATCH: enforce-minimum-security-policy]
export function normalizePolicy(input={}) {
  const out = {};
  for (const section of Object.keys(DEFAULT_POLICY)) {
    out[section] = {};
    const allowed = POLICY_KEYS[section] || [];
    for (const key of allowed) {
      const fallback = DEFAULT_POLICY[section][key];
      const value = input && typeof input === 'object' && input[section] && typeof input[section] === 'object'
        ? input[section][key] : undefined;
      if (typeof fallback === 'boolean') out[section][key] = typeof value === 'boolean' ? value : fallback;
      else if (typeof fallback === 'number') out[section][key] = Number.isInteger(value) && value > 0 ? value : fallback;
      else if (typeof fallback === 'string') out[section][key] = typeof value === 'string' && value.length <= 64 ? value : fallback;
    }
    Object.freeze(out[section]);
  }
  return Object.freeze(out);
}
=======
export function normalizePolicy(input={}) {
  const out = {};
  for (const section of Object.keys(DEFAULT_POLICY)) {
    out[section] = {};
    const allowed = POLICY_KEYS[section] || [];
    for (const key of allowed) {
      const fallback = DEFAULT_POLICY[section][key];
      const value = input && typeof input === 'object' && input[section] && typeof input[section] === 'object'
        ? input[section][key] : undefined;
      if (typeof fallback === 'boolean') {
        // بوابات التحقق والسلامة الإلزامية لا يمكن للعميل تعطيلها
        const isMandatoryTrue = fallback === true && [
          'requireParse', 'requireIntegrity', 'requireReplay', 'atomic', 'rejectExternalMutation'
        ].includes(key);
        out[section][key] = isMandatoryTrue ? true : (typeof value === 'boolean' ? value : fallback);
      } else if (typeof fallback === 'number') {
        // منع العميل من تخطي الحد الأقصى لعدد الملفات
        out[section][key] = Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
      } else if (typeof fallback === 'string') {
        // حظر الاكتشافات الحرجة غير قابل للتخفيض إطلاقاً
        if (section === 'security' && key === 'critical') {
          out[section][key] = 'block';
        } else if (typeof value === 'string' && value.length <= 64) {
          out[section][key] = value;
        } else {
          out[section][key] = fallback;
        }
      }
    }
    Object.freeze(out[section]);
  }
  return Object.freeze(out);
}
>>>>>>> REPLACE
