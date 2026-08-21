-- Complete the P3 policy matrix with an explicit capability dimension.
ALTER TABLE federation_policies ADD COLUMN capability TEXT NOT NULL DEFAULT '*';
