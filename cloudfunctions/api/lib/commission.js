/**
 * 佣金计算（云端权威版本）
 * 必须与 miniprogram/utils/commission.js 保持一致。
 * 客户端算的是"给你看多少"，云函数算的是"真正发多少钱"，两边对不上就是事故。
 */
const RULE = {
  BASE_PRICE: 0.86,
  HIGH_FLOOR: 4,
  FLOOR_BONUS: 0.15,
  ON_TIME_BONUS: 0.30,
  MIN_PACK_INCOME: 2.0,
  MAX_ORDERS_PER_PACK: 6,
  MAX_VOLUME_UNITS: 6,
}

function round2(n) {
  return Math.round(n * 100) / 100
}

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

function calcPackIncome(orders, opts) {
  const options = opts || {}
  const detail = (orders || []).map(function (o, i) {
    return Object.assign({}, o, { fee: calcOrderFee(o, i) })
  })
  const subtotal = round2(detail.reduce(function (s, o) { return s + o.fee }, 0))
  const bonus = options.onTime ? RULE.ON_TIME_BONUS : 0
  return {
    total: round2(subtotal + bonus),
    subtotal: subtotal,
    bonus: bonus,
    detail: detail,
    pushable: subtotal >= RULE.MIN_PACK_INCOME,
  }
}

function checkCapacity(orders) {
  if (orders.length > RULE.MAX_ORDERS_PER_PACK) {
    return { ok: false, reason: '包内单量超上限' }
  }
  const volume = orders.reduce(function (s, o) { return s + (o.volume || 1) }, 0)
  if (volume > RULE.MAX_VOLUME_UNITS) {
    return { ok: false, reason: '体积超上限' }
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
