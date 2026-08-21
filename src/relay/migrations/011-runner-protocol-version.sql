-- Persist the negotiated Runner protocol on the authenticated Runner record.
-- Task fencing must not infer protocol compatibility from a global switch.
ALTER TABLE runners ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
