-- Table to store processed document results
CREATE TABLE IF NOT EXISTS processed_documents (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    document_type VARCHAR(100),
    extracted_text TEXT,
    entities JSONB,
    processing_device VARCHAR(50),
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_documents_filename ON processed_documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_type ON processed_documents(document_type);
