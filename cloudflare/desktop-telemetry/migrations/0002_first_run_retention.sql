CREATE TABLE IF NOT EXISTS telemetry_first_runs (
  retention_id TEXT PRIMARY KEY NOT NULL CHECK (length(retention_id) BETWEEN 35 AND 67),
  first_run_day TEXT NOT NULL CHECK (
    length(first_run_day) = 10
    AND substr(first_run_day, 5, 1) = '-'
    AND substr(first_run_day, 8, 1) = '-'
  ),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 80),
  platform TEXT NOT NULL CHECK (length(platform) BETWEEN 1 AND 32),
  architecture TEXT NOT NULL CHECK (length(architecture) BETWEEN 1 AND 32),
  os_major TEXT NOT NULL CHECK (length(os_major) BETWEEN 1 AND 7),
  notice_version INTEGER NOT NULL CHECK (notice_version >= 2),
  onboarding_version INTEGER NOT NULL CHECK (onboarding_version >= 1)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_telemetry_first_runs_day
  ON telemetry_first_runs (first_run_day);

CREATE TABLE IF NOT EXISTS telemetry_retention_daily_active (
  activity_day TEXT NOT NULL CHECK (
    length(activity_day) = 10
    AND substr(activity_day, 5, 1) = '-'
    AND substr(activity_day, 8, 1) = '-'
  ),
  retention_id TEXT NOT NULL CHECK (length(retention_id) BETWEEN 35 AND 67),
  app_version TEXT NOT NULL CHECK (length(app_version) BETWEEN 1 AND 80),
  platform TEXT NOT NULL CHECK (length(platform) BETWEEN 1 AND 32),
  architecture TEXT NOT NULL CHECK (length(architecture) BETWEEN 1 AND 32),
  os_major TEXT NOT NULL CHECK (length(os_major) BETWEEN 1 AND 7),
  notice_version INTEGER NOT NULL CHECK (notice_version >= 2),
  PRIMARY KEY (activity_day, retention_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_telemetry_retention_daily_identity
  ON telemetry_retention_daily_active (retention_id, activity_day);

CREATE TABLE IF NOT EXISTS telemetry_retention_rollups (
  cohort_day TEXT NOT NULL,
  retention_week INTEGER NOT NULL CHECK (retention_week >= 0),
  cohort_size INTEGER NOT NULL CHECK (cohort_size >= 0),
  retained_installations INTEGER NOT NULL CHECK (retained_installations >= 0),
  computed_day TEXT NOT NULL,
  PRIMARY KEY (cohort_day, retention_week)
) WITHOUT ROWID;
