/**
 * 定价引擎 —— 代理商发单时定价
 *
 * 学生是兼职工作者，不参与投标。价格由代理商在发单时定，
 * 学生看到价格决定抢不抢。所以这个引擎服务的是**代理商侧**：
 *
 *   1. 给一个建议价（楼层、距离、时段、池子积压）
 *   2. 校验代理商填的价格在合理区间
 *
 * 定低了没人抢（单子压在池子里），定高了亏本。系统的作用是让代理商
 * 不用拍脑袋——尤其"池子里积压多少单"这一项，人很难实时感知。
 */
const RULES = {
  // 发单价硬边界（元/单）
  minPrice: 0.5,
  maxPrice: 3.0,

  // 建议价 = 基础价 + 楼层 + 距离 + 高峰 + 积压
  base: 1.0,

  // 楼层加价：高区贵，因为要爬楼
  floorTiers: [
    { from: 6, bonus: 0.45 },
    { from: 4, bonus: 0.25 },
  ],

  // 距离加价：每 100 米 +0.05，封顶 0.4
  distancePer100m: 0.05,
  distanceCap: 0.4,

  // 高峰（午晚下课波次）加价
  rushBonus: 0.2,

  // 池子积压加价：每积压 1 单 +0.05，封顶 0.4
  backlogPerOrder: 0.05,
  backlogCap: 0.4,
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function floorBonusOf(floor, rules) {
  const cfg = rules || RULES
  for (let i = 0; i < cfg.floorTiers.length; i++) {
    if (floor >= cfg.floorTiers[i].from) return cfg.floorTiers[i].bonus
  }
  return 0
}

/**
 * 给代理商一个建议价
 * @param {Object} p { maxFloor, distanceMeters, isRush, backlog }
 * @returns {{price:number, breakdown:Object}}
 */
function suggestPrice(p, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const maxFloor = Number(p.maxFloor) || 1
  const distance = Number(p.distanceMeters) || 0
  const backlog = Number(p.backlog) || 0

  const floor = floorBonusOf(maxFloor, cfg)
  const distanceBonus = clamp(
    (distance / 100) * cfg.distancePer100m, 0, cfg.distanceCap
  )
  const rush = p.isRush ? cfg.rushBonus : 0
  const backlogBonus = clamp(backlog * cfg.backlogPerOrder, 0, cfg.backlogCap)

  const raw = cfg.base + floor + distanceBonus + rush + backlogBonus
  const price = round2(clamp(raw, cfg.minPrice, cfg.maxPrice))

  return {
    price: price,
    breakdown: {
      base: cfg.base,
      floor: round2(floor),
      distance: round2(distanceBonus),
      rush: round2(rush),
      backlog: round2(backlogBonus),
      // 触顶说明价格已经压到上限，继续积压只会更糟
      capped: round2(raw) > cfg.maxPrice,
    },
  }
}

/** 代理商填的价格是否合法 */
function validatePostPrice(price, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const p = Number(price)

  if (typeof price !== 'number' || !isFinite(p) || p <= 0) {
    return { ok: false, reason: 'invalid_price' }
  }
  if (p < cfg.minPrice) return { ok: false, reason: 'below_floor' }
  if (p > cfg.maxPrice) return { ok: false, reason: 'above_ceiling' }

  return { ok: true, value: round2(p) }
}

/** 整批成本 = 单价 × 单数 */
function batchCost(price, orderCount) {
  return round2(Number(price) * Number(orderCount || 0))
}

module.exports = {
  RULES: RULES,
  suggestPrice: suggestPrice,
  validatePostPrice: validatePostPrice,
  floorBonusOf: floorBonusOf,
  batchCost: batchCost,
}
