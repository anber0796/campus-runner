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
  el._t = setTimeout(function () { el.classList.remove('show') }, 2200)
}

async function api(path, body) {
  const opt = body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : {}
  const res = await fetch(path, opt)
  return res.json()
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
      '此时佣金压不到 1.0 元以下，降本模型不成立——要么开更多楼栋密度，要么减少波次、把主力波次做满。</div>'
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

function renderPacks() {
  const packs = STATE.packs
  if (!packs.length) {
    $('#packs-list').innerHTML = '<div class="empty">还没有顺路包</div>'
    return
  }
  $('#packs-list').innerHTML = packs.map(function (p) {
    const orders = p.orderList.map(function (o) {
      return '<div class="order-mini">' +
        '<div class="tail">尾号 ' + esc(o.tail) + '</div>' +
        '<div>' + esc(o.stallName) + '</div>' +
        '<div class="muted">' + esc(p.buildingName) + ' ' + esc(o.room) + ' · ' + esc(o.floor) + ' 层</div>' +
        '</div>'
    }).join('')

    const caption = '这一趟 ¥' + p.income.total + ' · 顺路 9 分钟 · 帮 ' + p.orderCount +
      ' 位同学带饭回 ' + p.buildingName

    return '<div class="pack">' +
      '<div class="pack-head">' +
        '<div class="pack-title">' + esc(p.canteenName) + ' · ' + p.orderCount + ' 单 · ' + esc(p.waveLabel) + '</div>' +
        '<span class="badge ' + (p.status === 'assigned' ? 'green' : '') + '">' +
          (p.status === 'assigned' ? '已指派 ' + esc(p.assignedTo) : '待派') + '</span>' +
      '</div>' +
      '<div class="pack-caption">' + esc(caption) + '</div>' +
      '<div class="orders-mini">' + orders + '</div>' +
      '<div class="pack-foot">' +
        '<input placeholder="指派给学生（姓名/学号）" data-assign="' + esc(p.id) + '" />' +
        '<button class="btn small" data-do-assign="' + esc(p.id) + '">指派</button>' +
        '<span class="money">¥' + p.income.total + '</span>' +
      '</div>' +
    '</div>'
  }).join('')
}

function renderPatrol() {
  const s = STATE.stats
  const actions = (s.patrol || []).map(function (a) {
    const label = {
      fallback_to_fleet: '回落自有运力',
      recycle: '回收并扣信用分',
      warn_deliver: '送达超时告警',
    }[a.action] || a.action
    const cls = a.action === 'warn_deliver' ? 'amber' : 'red'
    return '<div class="patrol-row">' +
      '<span>' + esc(a.packId) + ' · 已 ' + a.ageMin + ' 分钟</span>' +
      '<span class="badge ' + cls + '">' + esc(label) + '</span>' +
      '</div>'
  }).join('')

  $('#patrol-list').innerHTML = actions || '<div class="empty">暂时没有需要兜底的包</div>'
}

function renderAll() {
  renderStats()
  renderOrders()
  renderPacks()
  renderPatrol()
}

// ---------------------------------------------------------------- 交互

async function refresh() {
  STATE = await api('/api/state')
  renderAll()
}

$$('.tab').forEach(function (t) {
  t.addEventListener('click', function () {
    $$('.tab').forEach(function (x) { x.classList.remove('active') })
    $$('.panel').forEach(function (x) { x.classList.remove('active') })
    t.classList.add('active')
    $('#panel-' + t.dataset.tab).classList.add('active')
  })
})

$('#btn-seed').addEventListener('click', async function () {
  STATE = await api('/api/seed', {})
  renderAll()
  toast('已生成 ' + STATE.stats.totalOrders + ' 条演示订单')
})

$('#btn-pack').addEventListener('click', async function () {
  const r = await api('/api/pack', {})
  STATE = r.state
  renderAll()
  if (r.created === 0) {
    toast('没有可成包的订单，先生成演示订单')
  } else {
    toast('成包 ' + r.created + ' 个，包均 ' + r.stats.avgOrdersPerPack + ' 单')
  }
})

$('#btn-reset').addEventListener('click', async function () {
  STATE = await api('/api/reset', {})
  renderAll()
  toast('已重置')
})

$('#btn-simulate').addEventListener('click', async function () {
  const r = await api('/api/simulate', { minutes: 10 })
  STATE = r.state
  renderAll()
  toast('时间前进 10 分钟，触发 ' + r.actions.length + ' 条兜底动作')
})

// 事件委托：指派的输入框和按钮是动态渲染的
document.addEventListener('click', async function (e) {
  const id = e.target.getAttribute && e.target.getAttribute('data-do-assign')
  if (!id) return
  const input = document.querySelector('[data-assign="' + id + '"]')
  const name = input && input.value.trim()
  if (!name) return toast('先填个学生名字')
  STATE = await api('/api/assign', { packId: id, student: name })
  renderAll()
  toast('已指派给 ' + name)
})

refresh()
