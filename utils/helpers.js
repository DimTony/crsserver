function  getSubscriptionPrice(subscriptionType) {
  const SUBSCRIPTION_PRICES = {
    "mobile-v4-basic": 29.99,
    "mobile-v4-premium": 49.99,
    "mobile-v4-enterprise": 99.99,
    "mobile-v5-basic": 39.99,
    "mobile-v5-premium": 59.99,
    "full-suite-basic": 79.99,
    "full-suite-premium": 149.99,
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
