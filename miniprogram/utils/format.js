/** 展示层格式化工具 */

function money(n) {
  const v = Number(n || 0)
  return v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function moneyFixed(n) {
  return Number(n || 0).toFixed(2)
}

/** 订单尾号：平台 App 里靠它核对，统一取后 4 位 */
function tail(no) {
  const s = String(no || '')
  return s.length <= 4 ? s : s.slice(-4)
}

function clock(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function dateTime(ts) {
  const d = new Date(ts)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + clock(ts)
}

/** 距离某个时刻还有多少分钟（负数表示已过） */
function minutesUntil(hhmm) {
  const parts = String(hhmm || '00:00').split(':')
  const now = new Date()
  const target = new Date()
  target.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 60000)
}

function weekdayCN(d) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

module.exports = {
  money: money,
  moneyFixed: moneyFixed,
  tail: tail,
  clock: clock,
  dateTime: dateTime,
  minutesUntil: minutesUntil,
  weekdayCN: weekdayCN,
}
