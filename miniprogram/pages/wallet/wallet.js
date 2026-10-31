const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    pending: '0.00',
    settled: '0.00',
    logs: [],
    loading: true,
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    api.getWallet()
      .then(function (w) {
        that.setData({
          loading: false,
          pending: fmt.moneyFixed(w.pending),
          settled: fmt.moneyFixed(w.settled),
          logs: (w.logs || []).map(function (l) {
            return Object.assign({}, l, {
              amountText: '+' + fmt.moneyFixed(l.amount),
              timeText: fmt.dateTime(l.time),
              statusText: l.status === 'settled' ? '已结算' : '待结算',
            })
          }),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  withdraw() {
    wx.showToast({ title: '满 10 元可提现，T+1 到账', icon: 'none' })
  },
})
