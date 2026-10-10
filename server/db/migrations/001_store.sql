-- MagSwoop player data. Additive only: development and the published game share this database.
-- Provider-neutral on purpose: `provider`/`source` is 'stripe' today and can be 'steam' later.

-- Cloud save: settings, equipped skins and stats as one bounded JSON document per player.
CREATE TABLE IF NOT EXISTS ms_profiles (
  user_id INT NOT NULL PRIMARY KEY,
  save_json MEDIUMTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

-- Spendable balances. Every change is also written to ms_ledger with a unique ref (idempotency).
CREATE TABLE IF NOT EXISTS ms_wallets (
  user_id INT NOT NULL PRIMARY KEY,
  feathers INT NOT NULL DEFAULT 0,
  bonus_eggs INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS ms_ledger (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  ref VARCHAR(128) NOT NULL,
  feathers INT NOT NULL DEFAULT 0,
  bonus_eggs INT NOT NULL DEFAULT 0,
  reason VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ledger_ref (ref),
  KEY ledger_user (user_id, created_at)
);

-- What a player owns, whatever store sold it.
CREATE TABLE IF NOT EXISTS ms_entitlements (
  user_id INT NOT NULL,
  sku VARCHAR(48) NOT NULL,
  source VARCHAR(16) NOT NULL,
  source_ref VARCHAR(128) NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, sku)
);

-- Purchase history. amount_total/currency are cached from the completed Checkout Session so the
-- in-game history page does not call Stripe once per row; Stripe stays the source of truth.
CREATE TABLE IF NOT EXISTS ms_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(16) NOT NULL,
  product VARCHAR(48) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  checkout_session_id VARCHAR(255) NULL,
  payment_intent_id VARCHAR(255) NULL,
  subscription_id VARCHAR(255) NULL,
  amount_total INT NULL,
  currency CHAR(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY orders_session (checkout_session_id),
  KEY orders_user (user_id, created_at),
  KEY orders_pi (payment_intent_id)
);

CREATE TABLE IF NOT EXISTS ms_billing_customers (
  user_id INT NOT NULL,
  provider VARCHAR(16) NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, provider),
  UNIQUE KEY billing_customer (provider, customer_id)
);

CREATE TABLE IF NOT EXISTS ms_subscriptions (
  subscription_id VARCHAR(255) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(16) NOT NULL,
  product VARCHAR(48) NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_period_end DATETIME(3) NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY subscriptions_user (user_id)
);

-- Webhook redelivery guard.
CREATE TABLE IF NOT EXISTS ms_processed_events (
  provider VARCHAR(16) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider, event_id)
);
