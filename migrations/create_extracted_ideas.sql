-- Create bigidea_extracted_ideas table
CREATE TABLE IF NOT EXISTS bigidea_extracted_ideas (
    id SERIAL PRIMARY KEY,
    setup_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    thoughts JSONB NOT NULL,
    confidence DOUBLE PRECISION,
    source_document_id INTEGER,
    ai_model TEXT,
    ai_prompt_version TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    validation_session_id INTEGER,
    validation_stats JSONB,
    pushed_to_idea_id INTEGER,
    pushed_at TIMESTAMP,
    pushed_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    approved_at TIMESTAMP,
    approved_by INTEGER
);

-- Create bigidea_validation_ratings table
CREATE TABLE IF NOT EXISTS bigidea_validation_ratings (
    id SERIAL PRIMARY KEY,
    extracted_idea_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    rating TEXT NOT NULL,
    price DOUBLE PRECISION,
    indicator_snapshot JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_extracted_ideas_setup ON bigidea_extracted_ideas(setup_id);
CREATE INDEX IF NOT EXISTS idx_extracted_ideas_status ON bigidea_extracted_ideas(status);
CREATE INDEX IF NOT EXISTS idx_validation_ratings_idea ON bigidea_validation_ratings(extracted_idea_id);
