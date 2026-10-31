const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    loading: true,
    pack: null,
    accepting: false,
  },

  onLoad(query) {
    this.packId = query.id

  // 开发者工具重编译时可能把本页当入口直接打开（没有 id），
  // 这种情况直接回首页，别让用户看到一片空白 + 报错
  if (!this.packId) {
    wx.showToast({ title: '请从顺路包列表进入', icon: 'none' })
    setTimeout(function () { wx.switchTab({ url: '/pages/index/index' }) }, 800)
    return
  }

    this.load()
  },

  load() {
    const that = this
    api.getPack(this.packId)
      .then(function (pack) {
        // income.detail 里带着每一单的单价，直接拿来展示"钱是怎么算出来的"
        const orders = (pack.income.detail || []).map(function (o) {
          return Object.assign({}, o, { tail: fmt.tail(o.tail) })
        })
        that.setData({
          loading: false,
          pack: Object.assign({}, pack, {
            orders: orders,
            incomeText: fmt.money(pack.income.total),
            subtotalText: fmt.money(pack.income.subtotal),
          }),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  accept() {
    if (this.data.accepting) return
    const that = this
    this.setData({ accepting: true })
    api.acceptPack(this.packId)
      .then(function () {
        wx.showToast({ title: '接单成功', icon: 'success' })
        setTimeout(function () {
          wx.redirectTo({ url: '/pages/deliver/deliver?id=' + that.packId })
        }, 600)
      })
      .catch(function (e) {
        that.setData({ accepting: false })
        wx.showToast({ title: e.message || '接单失败', icon: 'none' })
      })
  },
})
