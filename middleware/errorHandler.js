const errorHandler = (err, req, res, next) => {
  // Log the error for server-side debugging
  console.error(err);

  // Set default error status code and message
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // In development, send detailed error information
  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({
      status: err.status,
      message: message,
      stack: err.stack,
      error: err,
    });
  }

  // In production, send a generic error message
  if (process.env.NODE_ENV === 'production') {
    // For operational errors, we can send the defined error message
    if (err.isOperational) {
      return res.status(statusCode).json({
        status: err.status,
        message: message,
      });
    }
    // For programming or other unknown errors, don't leak error details
    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong',
    });
  }
};

module.exports = errorHandler;
