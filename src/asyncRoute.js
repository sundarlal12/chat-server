/**
 * Wraps an async Express handler so a rejected promise reaches Express's
 * error pipeline via next(err) instead of becoming an unhandled rejection.
 * Express 4 does NOT catch async errors automatically (that's Express 5) -
 * without this, a single failed DB query crashes the whole process and
 * takes down chat for every connected user, not just the one request.
 * Confirmed this the hard way: a bad DB credential during local testing
 * killed the entire server via an uncaught exception.
 */
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncRoute };
