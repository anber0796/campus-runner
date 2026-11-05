const riderApi = require('../../utils/riderApi')
const fmt = require('../../utils/format')

/**
 * 按「档口在食堂的几楼」分组，楼层从低到高。
 * 同一食堂的多批会先合并再分组，所以动线是整栋食堂一起走的。
 */
function groupByStallFloor(orders) {
  const map = {}
  ;(orders || []).forEach(function (o) {
    const f = o.stallFloor || 1
    if (!map[f]) map[f] = []
    map[f].push(o)
  })

  return Object.keys(map)
    .map(Number)
    .sort(function (a, b) { return a - b })
    .map(function (f) {
      const list = map[f].slice().sort(function (a, b) {
        const sa = String(a.stallName || '')
        const sb = String(b.stallName || '')
        if (sa !== sb) return sa.localeCompare(sb)
        return String(a.tail).localeCompare(String(b.tail))
      })
      const stalls = []
      list.forEach(function (o) {
        if (o.stallName && stalls.indexOf(o.stallName) < 0) stalls.push(o.stallName)
      })
      return {
        floor: f,
        count: list.length,
        stallCount: stalls.length,
        pickedCount: list.filter(function (o) { return o.picked }).length,
        allDone: list.every(function (o) { return o.picked }),
        orders: list,
      }
    })
}

Page({
  data: {
    loading: true,
    error: '',
    canteenName: '',
    orderCount: 0,
    batchCount: 0,
    groups: [],
    nextStop: null,
    allPicked: false,
    undoId: '',
    inputNo: '',
    busy: false,
    primary: null,
  },

  onLoad(query) {
    this.filter = {
      canteen: (query && query.canteen) || '',
      wave: (query && query.wave) || '',
      id: (query && query.id) || '',
    }
  },

  onShow() { this.load() },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })

    riderApi
      .myBatches()
      .then(function (d) {
        const active = (d.active || []).filter(function (b) {
          return b.status === 'ASSIGNED' || b.status === 'CLAIMED'
        })

        const want = that.filter.canteen ? decodeURIComponent(that.filter.canteen) : ''
        let matched = active.filter(function (b) {
          if (that.filter.id) return b.id === that.filter.id
          if (!want) return true
          const sameCanteen = b.canteenId === want || b.canteenName === want
          const sameWave = !that.filter.wave || b.waveId === that.filter.wave
          return sameCanteen && sameWave
        })

        // 兜底：按食堂匹配不到就展示全部待取餐，宁可多给也不能白屏
        if (!matched.length) matched = active

        if (!matched.length) {
          that.setData({
            loading: false, groups: [], nextStop: null, primary: null,
            allPicked: false, orderCount: 0, batchCount: 0,
          })
          return
        }

        // 同一食堂的多批合并成一趟活，每单记住自己属于哪一批
        const orders = []
        matched.forEach(function (b) {
          ;(b.orderList || []).forEach(function (o) {
            orders.push(Object.assign({}, o, { batchId: b.id }))
          })
        })

        that.build(orders, matched)
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  build(rawOrders, batches) {
    const now = Date.now()
    const orders = rawOrders.map(function (o) {
      const r = fmt.remain(o.dueAt, now)
      return Object.assign({}, o, {
        remainText: r ? r.text : '',
        remainLevel: r ? r.level : '',
        // WXML 里没法拼字符串，预先算好撤销用的键
        undoKey: o.id + '|' + o.batchId,
      })
    })

    const allPicked = orders.length > 0 && orders.every(function (o) { return o.picked })
    const groups = groupByStallFloor(orders)

    let nextStop = null
    for (let i = 0; i < groups.length && !nextStop; i++) {
      const g = groups[i]
      for (let j = 0; j < g.orders.length; j++) {
        if (!g.orders[j].picked) {
          nextStop = {
            floorLabel: g.floor + 'F',
            stallName: g.orders[j].stallName || '档口',
            tail: g.orders[j].tail,
            remain: orders.filter(function (o) { return !o.picked }).length,
          }
          break
        }
      }
    }

    const remain = orders.length - orders.filter(function (o) { return o.picked }).length
    const primary = allPicked
      ? { kind: 'go-deliver', label: '已取齐 ' + orders.length + ' 单', sub: '去送达' }
      : { kind: 'pick', label: '扫码取餐', sub: '还剩 ' + remain + ' 单' }

    this.setData({
      loading: false,
      canteenName: (batches[0] && batches[0].canteenName) || '食堂',
      orderCount: orders.length,
      batchCount: batches.length,
      groups: groups,
      nextStop: nextStop,
      allPicked: allPicked,
      primary: primary,
    })
  },

  onInputNo(e) { this.setData({ inputNo: e.detail.value }) },

  scan() {
    const that = this
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: function (res) { that.doPickup(res.result) },
      fail: function () { wx.showToast({ title: '没扫到，可以手输运单号', icon: 'none' }) },
    })
  },

  manualPickup() {
    this.doPickup(this.data.inputNo)
  },

  // 按运单号找单：合并后可能来自不同批次，得逐单定位
  doPickup(orderNo) {
    if (this.data.busy) return
    const no = String(orderNo || '').trim()
    if (!no) return wx.showToast({ title: '请输入运单号', icon: 'none' })

    let hit = null
    this.data.groups.forEach(function (g) {
      g.orders.forEach(function (o) {
        if (!o.picked && (o.tail === no || String(o.id) === no)) hit = o
      })
    })
    if (!hit) return wx.showToast({ title: '这批里没有这个运单号', icon: 'none' })

    this.pick(hit)
  },

  pickOrder(e) {
    if (this.data.busy) return
    const orderId = e.currentTarget.dataset.id
    const batchId = e.currentTarget.dataset.batch

    let hit = null
    this.data.groups.forEach(function (g) {
      g.orders.forEach(function (o) {
        if (o.id === orderId && o.batchId === batchId) hit = o
      })
    })
    if (!hit) return
    this.pick(hit)
  },

  pick(order) {
    const that = this
    this.setData({ busy: true })
    riderApi
      .pickup(order.batchId, '', order.id)
      .then(function () {
        that.setData({ busy: false, undoId: order.id + '|' + order.batchId, inputNo: '' })
        wx.showToast({ title: '已取餐', icon: 'success' })
        that.load()
        clearTimeout(that._undoTimer)
        that._undoTimer = setTimeout(function () { that.setData({ undoId: '' }) }, 3000)
      })
      .catch(function (err) {
        that.setData({ busy: false })
        wx.showToast({ title: err.message || '取餐失败', icon: 'none' })
      })
  },

  undoPick(e) {
    const that = this
    const key = e.currentTarget.dataset.key || ''
    const parts = key.split('|')
    clearTimeout(this._undoTimer)

    riderApi
      .unpick(parts[1], parts[0])
      .then(function () {
        that.setData({ undoId: '' })
        wx.showToast({ title: '已撤销', icon: 'none' })
        that.load()
      })
      .catch(function (err) {
        wx.showToast({ title: err.message || '撤销失败', icon: 'none' })
      })
  },

  primaryTap() {
    const p = this.data.primary
    if (!p || this.data.busy) return
    if (p.kind === 'pick') return this.scan()
    if (p.kind === 'go-deliver') {
      wx.navigateTo({ url: '/pages/delivery/delivery' })
    }
  },
})
