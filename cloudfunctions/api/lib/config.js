/** 多校隔离用 tenantId，正式环境从环境变量读，避免硬编码 */
module.exports = {
  TENANT_ID: process.env.TENANT_ID || 'demo-school',
  // 单日接单上限（PRD 3.4：防影响上课，也防形成事实劳动关系）
  MAX_PACKS_PER_DAY: 4,
  // 接单后多少分钟未到店即回收（PRD 5.3）
  PICKUP_TIMEOUT_MIN: 12,
}
