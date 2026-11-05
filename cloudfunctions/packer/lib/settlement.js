/**
 * 结算与提现 —— 钱的部分，规则必须比功能写得死
 *
 * 三条设计：
 *   1. 送达后先计「待结算」，T+1 才转「可提现」
 *      —— 留一天缓冲，用来处理"用户说没收到""送错了"这类事后争议，
 *         否则钱已经提走，追不回来。
 *   2. 可提现 = 已结算收入 − 已申请的提现（含处理中）
 *      —— 处理中的提现必须先扣掉，否则同一天能提两次同一笔钱。
 *   3. 每人每天最多提现 1 次、最低 10 元
 *      —— 校园场景单笔就几块钱，不限次数会产生大量小额打款成本。
 *
 * 纯函数，不碰数据库。
 */
const RULES = {
  // 送达后多久转入可提现（小时）
  settleDelayHours: 24,
  // 单次最低提现金额
  minWithdraw: 10,
  // 每人每天最多提现次数
  maxWithdrawPerDay: 1,
  // 提现手续费率（0 表示不收）
  feeRate: 0,
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
}

/** 收入类流水 */
function isIncome(log) {
  return log && (log.type === 'claim_income' || log.type === 'invite_reward')
}

/** 提现类流水（失败的不算，钱退回来了） */
function isWithdraw(log) {
  return log && log.type === 'withdraw' && log.status !== 'failed'
}

/**
 * 把到期的待结算流水转成已结算
 * @returns {{logs:Array, settledCount:number, settledAmount:number}}
 */
function settleDue(logs, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const ts = now || Date.now()
  const out = []
  let count = 0
  let amount = 0

  ;(logs || []).forEach(function (log) {
    if (!isIncome(log) || log.status !== 'pending') {
      out.push(log)
      return
    }
    const due = (log.createdAt || 0) + cfg.settleDelayHours * 3600000
    if (ts >= due) {
      const next = Object.assign({}, log, { status: 'settled', settledAt: ts })
      out.push(next)
      count++
      amount += log.amount || 0
    } else {
      out.push(log)
    }
  })

  return { logs: out, settledCount: count, settledAmount: round2(amount) }
}

/**
 * 余额
 * @returns {{pending:number, settled:number, withdrawing:number, available:number}}
 */
function balance(logs) {
  let pending = 0
  let settled = 0
  let withdrawn = 0

  ;(logs || []).forEach(function (log) {
    if (isIncome(log)) {
      if (log.status === 'pending') pending += log.amount || 0
      if (log.status === 'settled' || log.status === 'withdrawn') settled += log.amount || 0
    }
    if (isWithdraw(log)) withdrawn += Math.abs(log.amount || 0)
  })

  const available = round2(Math.max(0, settled - withdrawn))
  return {
    pending: round2(pending),
    settled: round2(settled),
    withdrawing: round2(withdrawn),
    available: available,
  }
}

/** 今日已提现次数（含处理中） */
function withdrawalsToday(logs, now) {
  const ts = now || Date.now()
  return (logs || []).filter(function (l) {
    return isWithdraw(l) && sameDay(l.createdAt || 0, ts)
  }).length
}

/**
 * 能不能提这笔钱
 * @returns {{ok:boolean, reason?:string, amount?:number, fee?:number, actual?:number}}
 */
function canWithdraw(info, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const available = Number(info && info.available) || 0
  const amount = Number(info && info.amount) || 0
  const today = Number(info && info.withdrawalsToday) || 0

  if (amount <= 0 || !isFinite(amount)) return { ok: false, reason: 'invalid_amount' }
  if (amount < cfg.minWithdraw) return { ok: false, reason: 'below_min' }
  if (amount > available) return { ok: false, reason: 'insufficient' }
  if (today >= cfg.maxWithdrawPerDay) return { ok: false, reason: 'daily_limit' }

  const fee = round2(amount * cfg.feeRate)
  return { ok: true, amount: round2(amount), fee: fee, actual: round2(amount - fee) }
}

/** 生成一条提现流水（金额记负数，方便直接汇总） */
function buildWithdrawLog(openid, amount, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const fee = round2(Number(amount) * cfg.feeRate)
  return {
    openid: openid,
    type: 'withdraw',
    amount: -round2(Number(amount) - fee),
    fee: fee,
    status: 'pending',
    createdAt: now || Date.now(),
    title: '提现',
  }
}

module.exports = {
  RULES: RULES,
  settleDue: settleDue,
  balance: balance,
  withdrawalsToday: withdrawalsToday,
  canWithdraw: canWithdraw,
  buildWithdrawLog: buildWithdrawLog,
}
