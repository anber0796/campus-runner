/**
 * 兜底巡检 —— PRD 5.3
 *
 * 这里只做"该做什么"的判定，不执行。执行留给调用方（云函数定时器 / 后台按钮），
 * 这样规则可以单测，也不会因为一次误判把包改乱。
 *
 * 两条时间线（后台可调）：
 *   无人接：推出去 8 分钟还没人接        → 回落自有运力
 *   接了不动：接单 12 分钟还没到店核销   → 回收 + 信用分扣减
 */
const DEFAULTS = {
  acceptTimeoutMin: 8,
  pickupTimeoutMin: 12,
  // 送达时限：到店取餐后 15 分钟内送达（PRD 3.4 时效奖励）
  deliverTimeoutMin: 20,
}

function minutesSince(ts, now) {
  if (!ts) return Infinity
  return (now - ts) / 60000
}

function allPicked(pack) {
  const orders = pack.orders || []
  return orders.length > 0 && orders.every(function (o) { return o.picked })
}

/**
 * @param {Array} packs
 * @param {Number} now 时间戳
 * @param {Object} config
 * @returns {Array<{packId, action, reason, ageMin}>}
 */
function patrol(packs, now, config) {
  const cfg = Object.assign({}, DEFAULTS, config || {})
  const ts = now || Date.now()
  const actions = []

  ;(packs || []).forEach(function (p) {
    if (p.status === 'available') {
      const age = minutesSince(p.offeredAt || p.createdAt, ts)
      if (age >= cfg.acceptTimeoutMin) {
        actions.push({
          packId: p.id,
          action: 'fallback_to_fleet',
          reason: 'no_accept',
          ageMin: Math.round(age),
        })
      }
      return
    }

    if (p.status === 'accepted') {
      const age = minutesSince(p.acceptedAt, ts)
      if (!allPicked(p) && age >= cfg.pickupTimeoutMin) {
        actions.push({
          packId: p.id,
          action: 'recycle',
          reason: 'not_arrived',
          ageMin: Math.round(age),
        })
      }
      return
    }

    if (p.status === 'picked') {
      const age = minutesSince(p.pickedAt, ts)
      if (age >= cfg.deliverTimeoutMin) {
        actions.push({
          packId: p.id,
          action: 'warn_deliver',
          reason: 'deliver_timeout',
          ageMin: Math.round(age),
        })
      }
    }
  })

  return actions
}

module.exports = { DEFAULTS: DEFAULTS, patrol: patrol }
