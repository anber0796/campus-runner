/* 顺路 · 运营后台 前端逻辑（零依赖，原生 fetch） */

const $ = function (sel) { return document.querySelector(sel) }
const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)) }

let STATE = null

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  })
}

function toast(msg) {
  let el = document.querySelector('.toast')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(el._t)
  el._t = setTimeout(function () { el.classList.remove('show') }, 2400)
}

async function api(path, body) {
  const opt = body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : {}
  const res = await fetch(path, opt)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

// ---------------------------------------------------------------- 渲染

function renderStats() {
  const s = STATE.stats
  const cards = [
    { label: '订单总数', value: s.totalOrders },
    { label: '待成包', value: s.pendingOrders },
    { label: '顺路包', value: s.packCount },
    {
      label: '包均单量（命门 ≥3.5）',
      value: s.avgOrdersPerPack,
      cls: s.packCount === 0 ? '' : (s.avgOk ? 'good' : 'warn'),
    },
    { label: '已回落', value: s.fallbackCount, cls: s.fallbackCount ? 'warn' : '' },
    { label: '待处理告警', value: s.alertCount, cls: s.alertCount ? 'warn' : '' },
  ]
  $('#stats').innerHTML = cards.map(function (c) {
    return '<div class="stat-card">' +
      '<div class="stat-label">' + esc(c.label) + '</div>' +
      '<div class="stat-value ' + (c.cls || '') + '">' + esc(c.value) + '</div>' +
      '</div>'
  }).join('')

  const warn = $('#pack-warning')
  if (s.packCount === 0) {
    warn.className = 'card warn-card'
    warn.innerHTML = '<div class="muted">还没有成包。点右上角「生成演示订单」，再点「运行成包」。</div>'
  } else if (s.avgOk) {
    warn.className = 'card ok-card'
    warn.innerHTML = '<div>包均 <b>' + s.avgOrdersPerPack + '</b> 单，达到 3.5 的命门线。' +
      '按 PRD 9.1，包均从 3 提到 4，单校年净省从 12 万跳到 22 万。</div>'
  } else {
    warn.className = 'card warn-card'
    warn.innerHTML = '<div>包均只有 <b>' + s.avgOrdersPerPack + '</b> 单，低于 3.5。' +
      '此时佣金压不到 1.0 元以下，降本模型不成立。</div>'
  }
}

function renderOrders() {
  const orders = STATE.orders.slice(0, 120)
  const statusMap = {
    CREATED: { text: '待成包', cls: 'amber' },
    PACKED: { text: '已成包', cls: 'green' },
  }
  $('#orders-hint').textContent = '共 ' + STATE.orders.length + ' 单，显示前 ' + orders.length + ' 单'
  $('#orders-table tbody').innerHTML = orders.map(function (o) {
    const st = statusMap[o.status] || { text: o.status, cls: '' }
    return '<tr>' +
      '<td>' + esc(o.channelOrderNo) + '</td>' +
      '<td><span class="badge blue">' + esc(o.channel) + '</span></td>' +
      '<td>' + esc(o.buildingName) + '</td>' +
      '<td>' + esc(o.room) + '</td>' +
      '<td>' + esc(o.stallName) + '</td>' +
      '<td>' + esc(o.waveLabel) + '</td>' +
      '<td><span class="badge ' + st.cls + '">' + st.text + '</span></td>' +
      '</tr>'
  }).join('')
}

const PACK_STATUS = {
  available: { text: '待派', cls: '' },
  accepted: { text: '已接单', cls: 'green' },
  picked: { text: '已取餐', cls: 'blue' },
  delivered: { text: '已送达', cls: 'green' },
  fallback: { text: '已回落', cls: 'red' },
}

function renderPacks() {
  const packs = STATE.packs
  if (!packs.length) {
    $('#packs-list').innerHTML = '<div class="empty">还没有顺路包</div>'
    return
  }

  const options = STATE.students.map(function (s) {
    return '<option value="' + esc(s.id) + '">' + esc(s.name) + '（' + s.credit + ' 分）</option>'
  }).join('')

  $('#packs-list').innerHTML = packs.map(function (p) {
    const st = PACK_STATUS[p.status] || { text: p.status, cls: '' }

    const orders = p.orderList.map(function (o) {
      return '<div class="order-mini">' +
        '<div class="tail">尾号 ' + esc(o.tail) + '</div>' +
        '<div>' + esc(o.stallName) + '</div>' +
        '<div class="muted">' + esc(p.buildingName) + ' ' + esc(o.room) + ' · ' + esc(o.floor) + ' 层</div>' +
        '</div>'
    }).join('')

    const caption = '这一趟 ¥' + p.income.total + ' · 顺路 9 分钟 · 帮 ' + p.orderCount +
      ' 位同学带饭回 ' + p.buildingName

    let actions = ''
    if (p.status === 'available') {
      actions = '<select data-student-for="' + esc(p.id) + '">' + options + '</select>' +
        '<button class="btn small" data-do-assign="' + esc(p.id) + '">指派</button>'
    } else if (p.status === 'fallback') {
      actions = '<span class="muted">原因：' + esc(p.fallbackReason || '-') + '</span>' +
        '<button class="btn small" data-do-republish="' + esc(p.id) + '">重派回池</button>'
    } else if (p.status === 'accepted') {
      actions = '<span class="muted">接单：' + esc(p.assigneeName || '-') + '</span>'
    }

    return '<div class="pack">' +
      '<div class="pack-head">' +
        '<div class="pack-title">' + esc(p.id) + ' · ' + esc(p.canteenName) + ' · ' + p.orderCount + ' 单 · ' + esc(p.waveLabel) + '</div>' +
        '<span class="badge ' + st.cls + '">' + st.text + '</span>' +
      '</div>' +
      '<div class="pack-caption">' + esc(caption) + '</div>' +
      '<div class="orders-mini">' + orders + '</div>' +
      '<div class="pack-foot">' + actions + '<span class="money">¥' + p.income.total + '</span></div>' +
    '</div>'
  }).join('')
}

function renderPatrol() {
  const actions = STATE.stats.patrol || []
  $('#patrol-list').innerHTML = actions.length
    ? actions.map(function (a) {
      const label = {
        fallback_to_fleet: '回落自有运力',
        recycle: '回收 + 扣分',
        warn_deliver: '送达超时告警',
      }[a.action] || a.action
      const cls = a.action === 'warn_deliver' ? 'amber' : 'red'
      return '<div class="patrol-row">' +
        '<span>' + esc(a.packId) + ' · 已 ' + a.ageMin + ' 分钟</span>' +
        '<span class="badge ' + cls + '">' + esc(label) + '</span>' +
        '</div>'
    }).join('')
    : '<div class="empty">暂时没有需要兜底的包</div>'
}

function renderAlerts() {
  const alerts = STATE.alerts || []
  $('#alert-hint').textContent = alerts.length ? alerts.length + ' 条未处理' : ''
  $('#alert-list').innerHTML = alerts.length
    ? alerts.map(function (a) {
      const cls = a.severity === 'high' ? 'red' : (a.severity === 'medium' ? 'amber' : '')
      return '<div class="patrol-row">' +
        '<span>' + esc(a.message) + '</span>' +
        '<span class="badge ' + cls + '">' + esc(a.type) + '</span>' +
        '</div>'
    }).join('')
    : '<div class="empty">没有告警</div>'
}

function renderStudents() {
  $('#students-table tbody').innerHTML = (STATE.students || []).map(function (s) {
    const frozen = s.frozenUntil && s.frozenUntil > Date.now()
    return '<tr>' +
      '<td>' + esc(s.name) + '</td>' +
      '<td>' + esc(s.buildingId) + '</td>' +
      '<td>' + s.credit + '</td>' +
      '<td>' + (frozen
        ? '<span class="badge red">已冻结</span>'
        : '<span class="badge green">正常</span>') + '</td>' +
      '</tr>'
  }).join('')
}

function renderCreditLogs() {
  const logs = STATE.creditLogs || []
  const el = $('#credit-list')
  if (!el) return
  el.innerHTML = logs.length
    ? logs.map(function (l) {
      return '<div class="patrol-row">' +
        '<span>' + esc(l.reason) + ' · ' + esc(l.packId) + '</span>' +
        '<span class="badge red">' + l.delta + '</span>' +
        '</div>'
    }).join('')
    : '<div class="empty">还没有扣分记录</div>'
}

function renderAll() {
  renderStats()
  renderOrders()
  renderPacks()
  renderPatrol()
  renderAlerts()
  renderStudents()
  renderCreditLogs()
}

// ---------------------------------------------------------------- 交互

async function refresh() {
  STATE = await api('/api/state')
  renderAll()
}

async function run(fn, okMsg) {
  try {
    const r = await fn()
    if (r && r.state) STATE = r.state
    else if (r) STATE = r
    renderAll()
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg)
    return r
  } catch (e) {
    toast(e.message)
  }
}

$$('.tab').forEach(function (t) {
  t.addEventListener('click', function () {
    $$('.tab').forEach(function (x) { x.classList.remove('active') })
    $$('.panel').forEach(function (x) { x.classList.remove('active') })
    t.classList.add('active')
    $('#panel-' + t.dataset.tab).classList.add('active')
  })
})

$('#btn-seed').addEventListener('click', function () {
  run(function () { return api('/api/seed', {}) },
    function (r) { return '已生成 ' + r.stats.totalOrders + ' 条订单' })
})

$('#btn-pack').addEventListener('click', function () {
  run(function () { return api('/api/pack', {}) }, function (r) {
    return r.created === 0 ? '没有可成包的订单' : '成包 ' + r.created + ' 个，包均 ' + r.stats.avgOrdersPerPack + ' 单'
  })
})

$('#btn-reset').addEventListener('click', function () {
  run(function () { return api('/api/reset', {}) }, '已重置')
})

$('#btn-simulate').addEventListener('click', function () {
  run(function () { return api('/api/simulate', { minutes: 10 }) },
    function (r) { return '时间前进 10 分钟，判定出 ' + r.actions.length + ' 条兜底动作' })
})

$('#btn-execute').addEventListener('click', function () {
  run(function () { return api('/api/execute', {}) }, function (r) {
    if (!r.report || !r.report.applied.length) return '没有需要执行的动作'
    return '已执行 ' + r.report.applied.length + ' 条兜底动作'
  })
})

document.addEventListener('click', async function (e) {
  const t = e.target
  if (!t.getAttribute) return

  const assignId = t.getAttribute('data-do-assign')
  if (assignId) {
    const sel = document.querySelector('[data-student-for="' + assignId + '"]')
    const studentId = sel && sel.value
    if (!studentId) return toast('先选一个学生')
    return run(function () { return api('/api/assign', { packId: assignId, studentId: studentId }) }, '已指派')
  }

  const republishId = t.getAttribute('data-do-republish')
  if (republishId) {
    return run(function () { return api('/api/republish', { packId: republishId }) }, '已重派回池')
  }
})

refresh()
