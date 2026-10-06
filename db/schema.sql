-- 送迎管理システム スキーマ (MariaDB)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id                 TINYINT PRIMARY KEY DEFAULT 1,
  facility_name      VARCHAR(100) NOT NULL DEFAULT '',
  facility_address   VARCHAR(255) NOT NULL DEFAULT '',
  facility_lat       DECIMAL(9,6) NULL,
  facility_lng       DECIMAL(9,6) NULL,
  avg_speed_kmh      DECIMAL(4,1) NOT NULL DEFAULT 25.0,   -- 平均走行速度
  stop_minutes       TINYINT NOT NULL DEFAULT 3,           -- 1件あたり乗降時間
  wheelchair_minutes TINYINT NOT NULL DEFAULT 5,           -- 車椅子の乗降時間
  pickup_arrive_time TIME NOT NULL DEFAULT '09:30:00',     -- 迎え: 施設到着目標
  dropoff_depart_time TIME NOT NULL DEFAULT '16:00:00',    -- 送り: 施設出発時刻
  CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 車の大きさ／区分（運転者が運転できる車の種類と対応）
CREATE TABLE IF NOT EXISTS vehicle_classes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(50)  NOT NULL,            -- 車両名・ナンバー
  model               VARCHAR(100) NOT NULL DEFAULT '', -- 車種
  class_id            INT NOT NULL,                     -- 車の大きさ
  capacity            TINYINT UNSIGNED NOT NULL,        -- 乗車可能人数（運転者除く）
  wheelchair_capacity TINYINT UNSIGNED NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  note                VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_vehicles_class FOREIGN KEY (class_id) REFERENCES vehicle_classes(id),
  CHECK (wheelchair_capacity <= capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drivers (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(50) NOT NULL,
  kana    VARCHAR(50) NOT NULL DEFAULT '',
  active  BOOLEAN NOT NULL DEFAULT TRUE,
  note    VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS driver_vehicle_classes (
  driver_id INT NOT NULL,
  class_id  INT NOT NULL,
  PRIMARY KEY (driver_id, class_id),
  CONSTRAINT fk_dvc_driver FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  CONSTRAINT fk_dvc_class  FOREIGN KEY (class_id)  REFERENCES vehicle_classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,              -- 管理番号
  name        VARCHAR(50)  NOT NULL,
  kana        VARCHAR(50)  NOT NULL DEFAULT '',
  adl         ENUM('自立','見守り','一部介助','全介助') NOT NULL DEFAULT '自立',
  wheelchair  BOOLEAN NOT NULL DEFAULT FALSE,            -- 車椅子のまま乗車
  address     VARCHAR(255) NOT NULL DEFAULT '',
  lat         DECIMAL(9,6) NULL,
  lng         DECIMAL(9,6) NULL,
  days        SET('mon','tue','wed','thu','fri','sat','sun') NOT NULL DEFAULT '', -- 利用曜日
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  note        VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 運行計画（日付×迎え/送り）
CREATE TABLE IF NOT EXISTS route_plans (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  service_date  DATE NOT NULL,
  direction     ENUM('pickup','dropoff') NOT NULL,
  status        ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  note          VARCHAR(255) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan (service_date, direction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1台分の便
CREATE TABLE IF NOT EXISTS route_runs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  plan_id      INT NOT NULL,
  vehicle_id   INT NOT NULL,
  driver_id    INT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  depart_time  TIME NULL,       -- 施設出発（予定）
  return_time  TIME NULL,       -- 施設帰着（予定）
  distance_km  DECIMAL(6,1) NULL,
  actual_depart_time TIME NULL,
  actual_return_time TIME NULL,
  note         VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_runs_plan    FOREIGN KEY (plan_id)    REFERENCES route_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_runs_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_runs_driver  FOREIGN KEY (driver_id)  REFERENCES drivers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 立ち寄り（run_id が NULL = 未割当）
CREATE TABLE IF NOT EXISTS route_stops (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  plan_id       INT NOT NULL,
  run_id        INT NULL,
  client_id     INT NOT NULL,
  seq           INT NOT NULL DEFAULT 0,
  planned_time  TIME NULL,
  actual_time   TIME NULL,
  status        ENUM('planned','done','absent') NOT NULL DEFAULT 'planned',
  unassigned_reason VARCHAR(100) NOT NULL DEFAULT '',
  note          VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_stops_plan   FOREIGN KEY (plan_id)   REFERENCES route_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_stops_run    FOREIGN KEY (run_id)    REFERENCES route_runs(id)  ON DELETE SET NULL,
  CONSTRAINT fk_stops_client FOREIGN KEY (client_id) REFERENCES clients(id),
  UNIQUE KEY uq_stop_client (plan_id, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (id, facility_name) VALUES (1, 'デイサービス');
INSERT IGNORE INTO vehicle_classes (name, sort_order) VALUES
  ('軽自動車', 10), ('普通車', 20), ('ワゴン・ハイエース', 30), ('マイクロバス', 40);
