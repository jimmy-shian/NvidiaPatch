function requireAdminAuth(req, res, next) {
  next();
}

function requireSseAuth(req, res, next) {
  next();
}

module.exports = {
  requireAdminAuth,
  requireSseAuth
};
