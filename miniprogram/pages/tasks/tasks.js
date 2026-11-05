const riderApi = require('../../utils/riderApi')

const STATUS = {
  ASSIGNED: { text: '待取餐', cls: 'tag tag-amber' },
  CLAIMED: { text: '待取餐', cls: 'tag tag-amber' },
  PICKED: { text: '待送达', cls: 'tag' },
  DELIVERED: { text: '已完成', cls: 'tag tag-green' },
}

Page({
  data: {
    loading: true,
    error: '',
    tab: 'active',
    active: [],
    finished: [],
  },

  onShow() {
    this.load()
  },

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
        const decorate = function (list) {
          return (list || []).map(function (b) {
            const st = STATUS[b.status] || { text: b.status, cls: 'tag tag-gray' }
            return Object.assign({}, b, {
              statusText: st.text,
              statusClass: st.cls,
              earnText: '¥' + b.earn,
              buildingText: (b.buildingIds || [b.buildingId]).join(' + '),
              tailText: (b.tails || []).join(' / '),
            })
          })
        }
        that.setData({
          loading: false,
          active: decorate(d.active),
          finished: decorate(d.finished),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  goPickup(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/pickup/pickup?id=' + id })
  },
})
