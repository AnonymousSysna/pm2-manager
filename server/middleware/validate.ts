const { sanitizeProcessName } = require("../utils/validation");

function validateProcessParam(req, res, next) {
  try {
    req.params.name = sanitizeProcessName(req.params.name, "process name");
    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      error: error.message
    });
  }
}

module.exports = {
  validateProcessParam
};

