/** 成包器配置（多校隔离 + 运营可调参数） */
module.exports = {
  TENANT_ID: process.env.TENANT_ID || 'demo-school',

  // 出餐慢的档口不进包（PRD 4.3）——运营在后台按「延误档口名单」维护
  SLOW_STALLS: [],

  // 波次前多少分钟跑成包（配合定时触发器使用）
  PACK_AHEAD_MIN: 15,
}
