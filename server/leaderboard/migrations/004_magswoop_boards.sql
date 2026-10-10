-- MagSwoop boards. Immutable once scores exist: changed rules need a new board id.
-- Classic: one 2:30 season. Endless (Season+): runs until the last egg is lost.
INSERT IGNORE INTO game_lb_boards
(namespace,id,rules_version,direction,min_score,max_score,min_duration_ms,max_duration_ms,`open`)
VALUES
('production','season-v1','v1','desc',0,500000,5000,1800000,TRUE),
('production','endless-v1','v1','desc',0,5000000,5000,7200000,TRUE);
