/**
 * 全局配置
 *
 * USE_MOCK = true  → 用本地假数据，不连云开发，导入开发者工具就能点
 * USE_MOCK = false → 走云函数 api，需要先填 CLOUD_ENV 并部署云函数
 */
module.exports = {
  USE_MOCK: true,

  // 云开发环境 ID，形如 campus-runner-9gxxxxxxx（云开发控制台 → 设置 → 环境ID）
  CLOUD_ENV: '',

  // 订阅消息模板 ID：和小程序后台「订阅消息」里选中的模板一致
  // 留空则不会请求授权，也不会报错
  SUBSCRIBE_TEMPLATE_ID: '',

  // 产品名（占位，正式名待定）
  APP_NAME: '顺路',
}
