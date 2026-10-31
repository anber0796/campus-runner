/**
 * 订阅消息授权
 *
 * ⚠️ 关键限制：微信的「一次性订阅消息」是**一次授权只能推一条**。
 * 餐饮/校园类目拿不到「长期订阅」权限，所以别指望"授权一次、天天推到毕业"。
 *
 * 由此推出三条产品规则（都写在这里，避免以后有人随手加弹窗）：
 *   1. 不在冷启动时弹——用户还没理解产品，弹了就是拒绝，而且微信会记住拒绝
 *   2. 只在"刚爽完"的瞬间要——送达成功、认证通过、拿到首笔收入
 *   3. 一次只请求一个模板——多模板会让用户看到一长串授权项，通过率断崖下跌
 */
const config = require('./config')

const HINT_KEY = 'subscribe_asked_at'

function templateIds(extra) {
  const ids = []
  if (config.SUBSCRIBE_TEMPLATE_ID) ids.push(config.SUBSCRIBE_TEMPLATE_ID)
  ;(extra || []).forEach(function (id) {
    if (id && ids.indexOf(id) < 0) ids.push(id)
  })
  return ids
}

/**
 * 请求授权（建议在"刚完成一单"之后调用）
 * @returns {Promise<{accepted:boolean, skipped?:boolean, reason?:string}>}
 */
function request(extra) {
  const ids = templateIds(extra)

  if (!ids.length) {
    return Promise.resolve({ accepted: false, skipped: true, reason: 'no_template' })
  }
  if (!wx.requestSubscribeMessage) {
    return Promise.resolve({ accepted: false, skipped: true, reason: 'unsupported' })
  }

  return new Promise(function (resolve) {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: function (res) {
        const accepted = ids.some(function (id) { return res[id] === 'accept' })
        wx.setStorageSync(HINT_KEY, Date.now())
        resolve({ accepted: accepted, raw: res })
      },
      // 用户点了拒绝、或者没在小程序前台，都不该打断主流程
      fail: function (err) {
        resolve({ accepted: false, error: err })
      },
    })
  })
}

/** 距离上次请求是否已经超过 N 小时（避免送达后连点两次弹两次） */
function canAskAgain(hours) {
  const last = wx.getStorageSync(HINT_KEY) || 0
  return Date.now() - last > (hours || 6) * 3600 * 1000
}

module.exports = {
  request: request,
  canAskAgain: canAskAgain,
  templateIds: templateIds,
}
