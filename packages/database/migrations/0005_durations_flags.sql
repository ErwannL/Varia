-- Migration 0005 (J3) : durée de chaque test en baseline et drapeaux des résultats (SLOW, CDC §18.9).
ALTER TABLE tests ADD COLUMN duration_ms REAL;
ALTER TABLE mutation_results ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mutation_results ADD COLUMN test_duration_ms REAL;
