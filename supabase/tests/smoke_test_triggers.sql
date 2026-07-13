-- pgTAP adapter for the portable post-deploy schema contracts.
--
-- The assertion body deliberately lives outside supabase/tests so hosted
-- staging/production can execute it with plain psql and no pgTAP dependency.

SELECT plan(1);
\ir ../smoke/schema_contracts.sql
SELECT pass('portable schema smoke contracts completed without an exception');
SELECT * FROM finish();
