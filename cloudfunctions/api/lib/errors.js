/** 业务异常：带 code，直接透传给客户端 */
function AppError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

module.exports = { AppError: AppError }
