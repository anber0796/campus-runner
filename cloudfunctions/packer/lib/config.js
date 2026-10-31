/** 成包器配置（多校隔离 + 运营可调参数） */
module.exports = {
  TENANT_ID: process.env.TENANT_ID || 'demo-school',

  // 出餐慢的档口不进包（PRD 4.3）——运营在后台按「延误档口名单」维护
  SLOW_STALLS: [],

  // 波次前多少分钟跑成包（配合定时触发器使用）
  PACK_AHEAD_MIN: 15,

  // 订阅消息模板 ID（小程序后台 → 订阅消息 → 我的模板，选「订单/任务提醒」类）
  // 留空时 runNotify 会直接跳过，不会报错
  SUBSCRIBE_TEMPLATE_ID: process.env.SUBSCRIBE_TEMPLATE_ID || '',
}
