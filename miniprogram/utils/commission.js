/**
 * 佣金计算 —— 与 cloudfunctions/api/lib/commission.js 保持一致
 * 改规则时两边必须同步改，否则前端展示与后端结算会对不上。
 *
 * 规则来自 PRD 3.4：
 *   基础单价 0.86 元/单
 *   包内阶梯：第 1 单 100%，第 2～3 单 90%，第 4 单起 80%
 *   楼层加价：4 层及以上 +0.15 元/单
 *   时效奖励：取餐后 15 分钟内送达 +0.30 元/包
 *   包预估收益 < 2.0 元不推送
 */

const RULE = {
  BASE_PRICE: 0.86,
  HIGH_FLOOR: 4,
  FLOOR_BONUS: 0.15,
  ON_TIME_BONUS: 0.30,
  MIN_PACK_INCOME: 2.0,
  MAX_ORDERS_PER_PACK: 6,
  // 汤粉类按 2 个体积单位计
  MAX_VOLUME_UNITS: 6,
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/** 第 index 单（从 0 开始）的阶梯系数 */
function tierRatio(index) {
  if (index === 0) return 1
  if (index <= 2) return 0.9
  return 0.8
}

function calcOrderFee(order, index) {
  let fee = RULE.BASE_PRICE * tierRatio(index)
  if ((order.floor || 1) >= RULE.HIGH_FLOOR) fee += RULE.FLOOR_BONUS
  return round2(fee)
}

/**
 * 计算一个顺路包的收益
 * @param {Array} orders 订单数组，元素需含 floor
 * @param {Object} opts { onTime: 是否满足时效奖励 }
 * @returns {Object} { total, subtotal, bonus, detail, pushable }
 */
function calcPackIncome(orders, opts) {
  const options = opts || {}
  const detail = orders.map(function (o, i) {
    return Object.assign({}, o, { fee: calcOrderFee(o, i) })
  })
  const subtotal = round2(detail.reduce(function (s, o) { return s + o.fee }, 0))
  const bonus = options.onTime ? RULE.ON_TIME_BONUS : 0
  const total = round2(subtotal + bonus)

  return {
    total: total,
    subtotal: subtotal,
    bonus: bonus,
    detail: detail,
    // PRD：包预估收益下限 < ¥2.0 不推送，避免消耗推送额度、损伤信任
    pushable: subtotal >= RULE.MIN_PACK_INCOME,
  }
}

/** 包是否超出容量：单量、体积双重约束 */
function checkCapacity(orders) {
  if (orders.length > RULE.MAX_ORDERS_PER_PACK) {
    return { ok: false, reason: '包内单量超上限 ' + RULE.MAX_ORDERS_PER_PACK }
  }
  const volume = orders.reduce(function (s, o) { return s + (o.volume || 1) }, 0)
  if (volume > RULE.MAX_VOLUME_UNITS) {
    return { ok: false, reason: '体积超上限 ' + RULE.MAX_VOLUME_UNITS }
  }
  return { ok: true }
}

module.exports = {
  RULE: RULE,
  calcOrderFee: calcOrderFee,
  calcPackIncome: calcPackIncome,
  checkCapacity: checkCapacity,
  round2: round2,
}
