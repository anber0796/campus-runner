/**
 * 云函数统一入口 —— 单个函数 + action 路由。
 *
 * 为什么先用单函数：MVP 阶段部署步骤越少越好，一次上传就能跑通全部接口；
 * 等函数体积或冷启动成为问题时，再按 action 前缀拆成 packs / deliver / wallet 多个函数，
 * 客户端只需改 utils/api.js 里的 name，页面代码不动。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const handlers = Object.assign(
  {},
  require('./handlers/student'),
  require('./handlers/packs'),
  require('./handlers/deliver'),
  require('./handlers/wallet'),
  require('./handlers/orders')
)

exports.main = async function (event) {
  const action = event && event.action
  const fn = handlers[action]

  if (!fn) {
    return { code: 404, msg: '未知操作: ' + action }
  }

  const ctx = cloud.getWXContext()
  try {
    const data = await fn({ event: event, ctx: ctx, db: db, cloud: cloud })
    return { code: 0, data: data }
  } catch (e) {
    console.error('[api]', action, e)
    return { code: e.code || 500, msg: e.message || '服务器错误' }
  }
}
