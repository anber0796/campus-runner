const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    tab: 'active',
    active: [],
    finished: [],
    loading: true,
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    api.myOrders()
      .then(function (res) {
        that.setData({
          loading: false,
          active: that.decorate(res.active),
          finished: that.decorate(res.finished),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  decorate(list) {
    return (list || []).map(function (p) {
      return Object.assign({}, p, {
        incomeText: '¥' + fmt.money(p.income.total),
        timeText: p.deliveredAt ? fmt.dateTime(p.deliveredAt) : fmt.dateTime(p.acceptedAt || p.createdAt),
        statusText: p.status === 'delivered' ? '已完成' : (p.status === 'picked' ? '待送达' : '待取餐'),
      })
    })
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  open(e) {
    wx.navigateTo({ url: '/pages/deliver/deliver?id=' + e.currentTarget.dataset.id })
  },
})
