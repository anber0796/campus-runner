/**
 * 佣金计算（成包器副本）
 *
 * 云函数各自独立上传，跨目录 require 在云端会失败，所以这里必须有一份。
 * 一致性由 scripts/test-engine.js 的「双副本对拍」测试保证——两份算不出同样结果就报错。
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

module.exports = {
  RULE: RULE,
  calcOrderFee: calcOrderFee,
  calcPackIncome: calcPackIncome,
  round2: round2,
}
