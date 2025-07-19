function  getSubscriptionPrice(subscriptionType) {
  const SUBSCRIPTION_PRICES = {
    "mobile-v4-basic": 1249.99,
    "mobile-v4-premium": 1425.49,
    "mobile-v4-enterprise": 1999.99,
    "mobile-v5-basic": 2395.49,
    "mobile-v5-premium": 2629.99,
    "full-suite-basic": 2789.99,
    "full-suite-premium": 3145.49,
  };

  return SUBSCRIPTION_PRICES[subscriptionType] || 29.99;
};

function getSubscriptionDuration(subscriptionType) {
  const SUBSCRIPTION_TYPES = {
    "mobile-v4-basic": 30,
    "mobile-v4-premium": 60,
    "mobile-v4-enterprise": 90,
    "mobile-v5-basic": 30,
    "mobile-v5-premium": 60,
    "full-suite-basic": 60,
    "full-suite-premium": 90,
  };

  return SUBSCRIPTION_TYPES[subscriptionType] || 30;
}


module.exports = { getSubscriptionPrice, getSubscriptionDuration };
