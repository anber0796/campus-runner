/**
 * 竞价引擎 —— 校园众包「价低者得」
 *
 * 竞价单位：一批 = 同一食堂 × 同一楼栋 × 2～6 单
 *   （按楼栋成批，骑手取完直接走，不需要分拣；这是刻意设计，不是为了省事）
 *
 * 出价单位：元/单。整批结算 = 中标单价 × 单数。
 *   —— 用单均报价，学生一眼能算「这趟能赚多少」，也不会因为批次大小差异报价失准。
 *
 * 三道闸（防价格战把运力池抽干）：
 *   1. 底价 / 封顶：低于底价视为恶意，高于封顶视为哄抬
 *   2. 信用准入：分数不够只能被指派，不能进竞价
 *   3. 中标后限时确认：不确认就作废并扣分，防「先抢了再说」
 *
 * 纯函数，不碰数据库，可单测。
 */

const RULES = {
  minPrice: 0.5,          // 底价（元/单）
  maxPrice: 3.0,          // 封顶
  minBatchOrders: 2,
  maxBatchOrders: 6,
  maxBatchesPerDay: 6,    // 单日接批上限，防疲劳与事实劳动关系
  confirmWindowMin: 5,    // 中标后多少分钟内必须确认
  minCredit: 80,          // 低于此分不能竞价
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/** 批次唯一键：同食堂同楼同波次才算一批 */
function batchKey(b) {
  return [b.canteenId, b.buildingId, b.waveId].join('|')
}

/**
 * 他选的楼栋能不能覆盖这一批。
 * 学生注册时选「主楼 + 可顺路送的邻楼」，只有覆盖到才能抢——
 * 否则会出现"抢了 20 栋的单，结果找不到楼"。
 */
function canServe(student, batch) {
  if (!batch) return false
  const need = batch.buildingIds || (batch.buildingId ? [batch.buildingId] : [])
  const cover = student.coverageBuildings ||
    (student.buildingId ? [student.buildingId] : [])
  if (!cover.length) return false
  return need.every(function (b) { return cover.indexOf(b) >= 0 })
}

/**
 * 这个学生现在能不能出价
 * @returns {{ok:boolean, reason?:string}}
 */
function canBid(student, batch, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const ts = now || Date.now()

  if (!student) return { ok: false, reason: 'no_student' }
  if (student.status !== 'active') return { ok: false, reason: 'not_certified' }

  // 惩罚期：中标不履约的后果
  if (student.punishUntil && student.punishUntil > ts) {
    return { ok: false, reason: 'punished' }
  }

  if ((student.credit || 0) < cfg.minCredit) {
    return { ok: false, reason: 'credit_too_low' }
  }

  if ((student.batchesToday || 0) >= cfg.maxBatchesPerDay) {
    return { ok: false, reason: 'daily_limit' }
  }

  if (!batch) return { ok: false, reason: 'no_batch' }
  if (batch.status !== 'BIDDING') return { ok: false, reason: 'not_bidding' }
  if (!canServe(student, batch)) return { ok: false, reason: 'building_not_covered' }
  if (batch.bidDeadline && ts > batch.bidDeadline) return { ok: false, reason: 'expired' }

  const count = batch.orderCount || (batch.orders || []).length
  if (count < cfg.minBatchOrders) return { ok: false, reason: 'batch_too_small' }
  if (count > cfg.maxBatchOrders) return { ok: false, reason: 'batch_too_large' }

  return { ok: true }
}

/** 价格合法性：低于底价算恶意，高于封顶算哄抬 */
function validatePrice(price, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const p = Number(price)

  if (!isFinite(p) || p <= 0) return { ok: false, reason: 'invalid_price' }
  if (p < cfg.minPrice) return { ok: false, reason: 'below_floor' }
  if (p > cfg.maxPrice) return { ok: false, reason: 'above_ceiling' }

  return { ok: true, value: round2(p) }
}

/**
 * 排序规则：价低者先，同价先出价者先。
 * 同价按时间，是为了让「先下手」有确定性回报，否则同一毫秒内谁赢说不清。
 */
function rankBids(bids) {
  return (bids || [])
    .filter(function (b) { return b && b.status !== 'withdrawn' })
    .slice()
    .sort(function (a, b) {
      if (a.price !== b.price) return a.price - b.price
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
      return String(a.id).localeCompare(String(b.id))
    })
}

/**
 * 开标
 * @returns {{winner:Object|null, price:number|null, reason:string, ranked:Array}}
 */
function awardBatch(batch, bids, options) {
  const cfg = Object.assign({}, RULES, (options && options.rules) || {})
  const ranked = rankBids(bids)

  if (!ranked.length) {
    return { winner: null, price: null, reason: 'no_bids', ranked: [] }
  }

  const top = ranked[0]
  const check = validatePrice(top.price, cfg)

  // 底价是硬闸：所有出价都违规时，宁可流拍也不成交
  if (!check.ok) {
    return { winner: null, price: null, reason: 'all_invalid:' + check.reason, ranked: ranked }
  }

  return {
    winner: top,
    price: check.value,
    reason: 'awarded',
    ranked: ranked,
  }
}

/** 整批结算金额 */
function settle(price, orderCount) {
  return round2(Number(price) * Number(orderCount || 0))
}

/** 中标后超过确认窗口未确认 → 作废 */
function isConfirmExpired(award, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  if (!award || !award.awardedAt) return false
  return ((now || Date.now()) - award.awardedAt) > cfg.confirmWindowMin * 60000
}

/**
 * 单日累计：一天最多接几批。跨天自动归零的判定放在调用方，
 * 这里只做"加上这一批会不会超"。
 */
function wouldExceedDaily(student, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  return (student.batchesToday || 0) >= cfg.maxBatchesPerDay
}

module.exports = {
  RULES: RULES,
  batchKey: batchKey,
  canBid: canBid,
  canServe: canServe,
  validatePrice: validatePrice,
  rankBids: rankBids,
  awardBatch: awardBatch,
  settle: settle,
  isConfirmExpired: isConfirmExpired,
  wouldExceedDaily: wouldExceedDaily,
}
